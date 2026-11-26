import { createApp } from "./app.js";
import { qoreChain } from "./chain.js";
import { loadConfig } from "./config.js";
import { JsonFileStore } from "./store.js";

const config = loadConfig();
const store = await JsonFileStore.open(config.dataFile);
const app = createApp({ config, store, chain: qoreChain(config) });

app.listen(config.port, () => {
  console.log(`TRACE//RUN verifier on :${config.port} · ${config.chainId} via ${config.rest}`);
  if (config.dailySecret === "dev-only-secret-change-me") {
    console.warn("DAILY_SECRET is not set: using a development secret.");
  }
});
