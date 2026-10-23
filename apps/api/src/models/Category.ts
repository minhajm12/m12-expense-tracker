import mongoose, { Schema, Document, Model } from "mongoose";
import {
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INVESTMENT_CATEGORIES,
} from "@finora/shared";

export interface ICategory extends Document {
  _id: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  name: string;
  type: "income" | "expense" | "investment";
  icon: string;
  color: string;
  subcategories: string[];
  isCustom: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<ICategory>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
      default: null,
    },
    name: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
      maxlength: [100, "Category name cannot exceed 100 characters"],
    },
    type: {
      type: String,
      enum: ["income", "expense", "investment"],
      required: [true, "Category type must be income, expense, or investment"],
      index: true,
    },
    icon: {
      type: String,
      default: "Folder",
    },
    color: {
      type: String,
      default: "#10b981",
    },
    subcategories: {
      type: [String],
      default: [],
    },
    isCustom: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc: any, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

CategorySchema.index({ userId: 1, type: 1, name: 1 });

export const Category: Model<ICategory> =
  mongoose.models.Category ||
  mongoose.model<ICategory>("Category", CategorySchema);

export const seedDefaultCategories = async (): Promise<{ seeded: number; missingNames: string[] }> => {
  const defaultDocs = [
    ...DEFAULT_INCOME_CATEGORIES.map((c) => ({
      userId: null,
      name: c.name,
      type: "income" as const,
      icon: c.icon,
      color: c.color,
      isCustom: false,
      subcategories: [],
    })),
    ...DEFAULT_EXPENSE_CATEGORIES.map((c) => ({
      userId: null,
      name: c.name,
      type: "expense" as const,
      icon: c.icon,
      color: c.color,
      isCustom: false,
      subcategories: [],
    })),
    ...DEFAULT_INVESTMENT_CATEGORIES.map((c) => ({
      userId: null,
      name: c.name,
      type: "investment" as const,
      icon: c.icon,
      color: c.color,
      isCustom: false,
      subcategories: [],
    })),
  ];

  const existingCategories = await Category.find({ userId: null }).select("name type").lean();
  const existingSet = new Set(
    existingCategories.map((c) => `${c.type}:${c.name.trim().toLowerCase()}`)
  );

  const missingCategories = defaultDocs.filter(
    (c) => !existingSet.has(`${c.type}:${c.name.trim().toLowerCase()}`)
  );

  if (missingCategories.length > 0) {
    await Category.insertMany(missingCategories);
    const names = missingCategories.map((m) => m.name);
    console.log(`✅ [Database] Seeded ${missingCategories.length} default category(ies): ${names.join(", ")}`);
    return { seeded: missingCategories.length, missingNames: names };
  }

  return { seeded: 0, missingNames: [] };
};
