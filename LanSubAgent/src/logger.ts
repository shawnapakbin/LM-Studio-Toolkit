import { getLogger } from "llm-toolkit-observability";

/** Module-level logger for the LAN Sub Agent */
const logger = getLogger().child("lan-subagent");

export { logger };
export type Logger = typeof logger;
