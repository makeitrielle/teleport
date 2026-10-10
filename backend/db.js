import mongoose from "mongoose";
import Passenger from "./models/Passenger.js";
import Ticket from "./models/Ticket.js";

export async function removeLegacyPhoneUniqueness(
  collection = Passenger.collection,
) {
  const indexes = await collection
    .indexes()
    .catch((err) => (err.code === 26 ? [] : Promise.reject(err)));
  // Phone is optional and is not an account identifier. Older deployments
  // made it unique, so the default empty string blocked every later signup.
  for (const index of indexes) {
    if (
      index.unique &&
      Object.keys(index.key).length === 1 &&
      index.key.phone
    ) {
      try {
        await collection.dropIndex(index.name);
        console.log("[db] removed obsolete unique phone index:", index.name);
      } catch (err) {
        // Another backend instance may already have completed this migration.
        if (err.code !== 27) throw err;
      }
    }
  }
}

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Copy .env.example to .env and fill it in.",
    );
  }
  await mongoose.connect(uri);
  await removeLegacyPhoneUniqueness();
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
