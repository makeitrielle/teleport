import mongoose from "mongoose";

const PassengerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, default: "Passenger" },
    category: {
      type: String,
      enum: ["regular", "student", "pwd", "senior"],
      default: "regular",
    },
    categoryVerified: { type: Boolean, default: false },
    requestedCategory: {
      type: String,
      enum: ["regular", "student", "pwd", "senior"],
      default: "regular",
    },
    phone: { type: String, default: "" },
    email: { type: String, lowercase: true, trim: true },
    trips: { type: Number, default: 0 },
    passwordHash: { type: String, default: null },
    emailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, default: null },
    emailVerificationExpires: { type: Date, default: null },
    passwordResetTokenHash: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },
  },
  { timestamps: true },
);

export default mongoose.model("Passenger", PassengerSchema);
