import mongoose from "mongoose";

const AdminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    role: { type: String, enum: ["staff", "admin"], default: "staff" },
    kioskId: { type: String, required: true, unique: true },
    busId: { type: mongoose.Schema.Types.ObjectId, ref: "Bus", default: null },
    // In production, store a bcrypt hash, never a plain password.
    passwordHash: { type: String, required: true },
  },
  { timestamps: true },
);

export default mongoose.model("Admin", AdminSchema);
