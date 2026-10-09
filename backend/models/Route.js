import mongoose from "mongoose";

const RouteSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    stops: { type: [String], default: [] },
  },
  { timestamps: true },
);

export default mongoose.model("Route", RouteSchema);
