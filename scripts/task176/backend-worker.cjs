// Wait until the parent has recorded our process identity. If it dies before
// that point, IPC closes and this worker exits before opening any sockets.
if (!process.send) process.exit(1);

process.once("disconnect", () => process.exit(1));
process.once("message", (message) => {
  if (message !== "start") process.exit(1);
  process.removeAllListeners("disconnect");
  process.disconnect();
  require(process.argv[2]);
});
