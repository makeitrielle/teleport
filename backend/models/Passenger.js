import mongoose from "mongoose";

const PassengerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String },
    trips: { type: Number, default: 0 },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.model("Passenger", PassengerSchema);
