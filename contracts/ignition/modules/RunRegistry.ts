import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys RunRegistry. The verifier defaults to the deployer, so the same
 * key can write runs during the hackathon; rotate it later with setVerifier.
 *
 * On QoreChain the deployer needs a registered ML-DSA-87 key and a live EVM
 * authorisation window first (`npm run window -- open`). Opening the window is
 * a hybrid-signed native transaction.
 */
export default buildModule("RunRegistryModule", (m) => {
  const verifier = m.getParameter("verifier", m.getAccount(0));
  const registry = m.contract("RunRegistry", [verifier]);
  return { registry };
});
