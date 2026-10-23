import { Request, Response } from 'express';
import { User } from '../models/User';
import { AuditLog } from '../models/AuditLog';
import { sendSuccess, sendError, AppError } from '../utils/api-response';
import { UserRole, registerSchema, paginationQuerySchema } from '@finora/shared';
import { signToken, sendAuthCookie } from '../utils/token';

export const getBootstrapStatus = async (req: Request, res: Response): Promise<void> => {
  const adminCount = await User.countDocuments({ role: UserRole.ADMIN });
  sendSuccess(res, {
    isBootstrapOpen: adminCount === 0,
    adminCount,
  });
};

export const bootstrapFirstAdmin = async (req: Request, res: Response): Promise<void> => {
  // Check if any administrator currently exists
  const adminCount = await User.countDocuments({ role: UserRole.ADMIN });
  if (adminCount > 0) {
    sendError(
      res,
      'Initial admin bootstrapping is closed. An administrator account already exists.',
      403,
      'BOOTSTRAP_DISABLED'
    );
    return;
  }

  // 1. If currently logged in, promote the authenticated user directly
  if (req.user) {
    req.user.role = UserRole.ADMIN;
    await req.user.save();

    await AuditLog.create({
      userId: req.user._id,
      action: 'BOOTSTRAP_PROMOTED_ADMIN',
      targetUserId: req.user._id,
      details: { email: req.user.email },
    });

    const token = signToken({
      userId: req.user._id.toString(),
      role: req.user.role,
      tokenVersion: req.user.tokenVersion,
    });
    sendAuthCookie(res, token);
    sendSuccess(res, { user: req.user.toJSON(), token }, 'Promoted existing authenticated user to first admin', 200);
    return;
  }

  // 2. If email provided matches an existing registered user, promote them without overwriting their credentials
  if (req.body?.email) {
    const existingUser = await User.findOne({ email: req.body.email.toLowerCase().trim() });
    if (existingUser) {
      existingUser.role = UserRole.ADMIN;
      await existingUser.save();

      await AuditLog.create({
        userId: existingUser._id,
        action: 'BOOTSTRAP_PROMOTED_ADMIN',
        targetUserId: existingUser._id,
        details: { email: existingUser.email },
      });

      const token = signToken({
        userId: existingUser._id.toString(),
        role: existingUser.role,
        tokenVersion: existingUser.tokenVersion,
      });
      sendAuthCookie(res, token);
      sendSuccess(res, { user: existingUser.toJSON(), token }, 'Promoted existing user to first admin', 200);
      return;
    }
  }

  // 3. Otherwise, validate full payload and create new initial admin user
  const validatedData = registerSchema.parse(req.body);

  const admin = await User.create({
    email: validatedData.email,
    password: validatedData.password,
    fullName: validatedData.fullName,
    currency: validatedData.currency,
    role: UserRole.ADMIN,
  });

  await AuditLog.create({
    userId: admin._id,
    action: 'BOOTSTRAP_CREATED_FIRST_ADMIN',
    targetUserId: admin._id,
    details: { email: admin.email },
  });

  const token = signToken({
    userId: admin._id.toString(),
    role: admin.role,
    tokenVersion: admin.tokenVersion,
  });

  sendAuthCookie(res, token);
  sendSuccess(res, { user: admin.toJSON(), token }, 'First administrator created successfully', 201);
};

export const listUsers = async (req: Request, res: Response): Promise<void> => {
  const query = paginationQuerySchema.parse(req.query);
  const skip = (query.page - 1) * query.limit;

  const filter: Record<string, unknown> = {};
  if (query.search) {
    filter.$or = [
      { email: { $regex: query.search, $options: 'i' } },
      { fullName: { $regex: query.search, $options: 'i' } },
    ];
  }

  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(query.limit)
      .select('-preferences'),
  ]);

  sendSuccess(
    res,
    users.map((u) => u.toJSON()),
    undefined,
    200,
    {
      timestamp: new Date().toISOString(),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    }
  );
};

export const updateUserStatus = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    sendError(res, 'Field "isActive" must be a boolean', 400, 'INVALID_INPUT');
    return;
  }

  // Prevent admin from deactivating themselves
  if (req.user && req.user._id.toString() === id && !isActive) {
    sendError(res, 'Administrators cannot deactivate their own account', 400, 'SELF_DEACTIVATION_FORBIDDEN');
    return;
  }

  const targetUser = await User.findById(id);
  if (!targetUser) {
    sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    return;
  }

  targetUser.isActive = isActive;
  if (!isActive) {
    // Invalidate sessions of deactivated user
    targetUser.tokenVersion += 1;
  }
  await targetUser.save();

  await AuditLog.create({
    userId: req.user?._id,
    action: isActive ? 'ADMIN_USER_ACTIVATED' : 'ADMIN_USER_DEACTIVATED',
    targetUserId: targetUser._id,
    details: { isActive },
  });

  sendSuccess(res, { user: targetUser.toJSON() }, `User account ${isActive ? 'activated' : 'deactivated'} successfully`);
};

export const updateUserRole = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { role } = req.body;

  if (!Object.values(UserRole).includes(role)) {
    sendError(res, `Role must be one of: ${Object.values(UserRole).join(', ')}`, 400, 'INVALID_ROLE');
    return;
  }

  // Prevent admin from demoting themselves
  if (req.user && req.user._id.toString() === id && role !== UserRole.ADMIN) {
    sendError(res, 'Administrators cannot demote their own account', 400, 'SELF_DEMOTION_FORBIDDEN');
    return;
  }

  const targetUser = await User.findById(id);
  if (!targetUser) {
    sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    return;
  }

  targetUser.role = role;
  await targetUser.save();

  await AuditLog.create({
    userId: req.user?._id,
    action: 'ADMIN_USER_ROLE_CHANGED',
    targetUserId: targetUser._id,
    details: { newRole: role },
  });

  sendSuccess(res, { user: targetUser.toJSON() }, `User role updated to ${role}`);
};

export const listAuditLogs = async (req: Request, res: Response): Promise<void> => {
  const query = paginationQuerySchema.parse(req.query);
  const skip = (query.page - 1) * query.limit;

  const [total, logs] = await Promise.all([
    AuditLog.countDocuments({}),
    AuditLog.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(query.limit),
  ]);

  sendSuccess(
    res,
    logs.map((l) => l.toJSON()),
    undefined,
    200,
    {
      timestamp: new Date().toISOString(),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    }
  );
};

