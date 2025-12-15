// Throwaway helper: starts an in-memory MongoDB (mongodb-memory-server, same
// package/version pin the test suite already uses) and keeps the process
// alive, printing the connection URI so the backend dev server can point at
// it via MONGODB_URI. Kill this process (or Ctrl+C) to tear the instance down.
process.env.MONGOMS_VERSION ??= "4.4.29";

const { MongoMemoryServer } = require("mongodb-memory-server");

(async () => {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri("datasense");
  console.log("MONGO_URI=" + uri);
  console.log("MONGO_READY");

  process.on("SIGINT", async () => {
    await mongod.stop();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await mongod.stop();
    process.exit(0);
  });
})();
