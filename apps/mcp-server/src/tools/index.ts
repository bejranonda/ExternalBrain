import type { AuthContext } from "../auth.js";
import { retrieveKnowledge } from "./retrieve.js";
import { reportSessionOutcome } from "./report.js";
import { teachKnowledge } from "./teach.js";
import { retireKnowledge } from "./retire.js";
import { getUserStyle } from "./style.js";
import { askOracle } from "./oracle.js";
import { logEvent } from "./log-event.js";
import { findSkill } from "./find-skill.js";
import { sessionSearch } from "./session-search.js";
import { startSession } from "./start-session.js";
import { createProject } from "./create-project.js";
import { listProjects } from "./list-projects.js";
import { getActiveProject } from "./get-active-project.js";
import { whoami } from "./whoami.js";

export interface ToolDef<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: I, auth: AuthContext) => Promise<O>;
}

export const tools: ToolDef[] = [
  startSession,
  createProject,
  listProjects,
  getActiveProject,
  retrieveKnowledge,
  reportSessionOutcome,
  teachKnowledge,
  retireKnowledge,
  getUserStyle,
  askOracle,
  logEvent,
  findSkill,
  sessionSearch,
  // Deliberately NOT capability-gated: a diagnostic a restricted token
  // cannot call is useless precisely when the restriction is the confusion.
  whoami,
];

const byName = new Map(tools.map((t) => [t.name, t]));

export async function callTool(
  name: string,
  input: unknown,
  auth: AuthContext,
): Promise<unknown> {
  const tool = byName.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.handler(input, auth);
}
