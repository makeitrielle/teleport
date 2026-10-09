import mongoose from "mongoose";
import Passenger from "./models/Passenger.js";
import Ticket from "./models/Ticket.js";

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Copy .env.example to .env and fill it in.",
    );
  }
  await mongoose.connect(uri);
  // Booking must never open before its database uniqueness constraint exists.
  await Ticket.init();
  await Ticket.collection.createIndex(
    { tripId: 1, seatId: 1 },
    {
      unique: true,
      partialFilterExpression: {
        tripId: { $type: "objectId" },
        seatId: { $type: "number" },
        status: "active",
      },
    },
  );
  // Keep email unique while allowing legacy passenger documents without email.
  let indexes = await Passenger.collection
    .indexes()
    .catch((err) => (err.code === 26 ? [] : Promise.reject(err)));
  const legacyEmailIndex = indexes.find(
    (index) => index.key?.email === 1 && index.unique && !index.sparse,
  );
  if (legacyEmailIndex)
    await Passenger.collection.dropIndex(legacyEmailIndex.name);
  indexes = await Passenger.collection
    .indexes()
    .catch((err) => (err.code === 26 ? [] : Promise.reject(err)));
  if (
    !indexes.some(
      (index) => index.key?.email === 1 && index.unique && index.sparse,
    )
  ) {
    await Passenger.collection.createIndex(
      { email: 1 },
      { unique: true, sparse: true },
    );
  }
  console.log("[db] connected to MongoDB");
}
