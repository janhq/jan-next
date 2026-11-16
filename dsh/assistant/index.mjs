const owIsMacOS = process.platform === 'darwin'

// dsh/assistant/host.ts
import { fs as fs2 } from "../native/runtime.mjs";
import { registerApi } from "../native/api.mjs";

// dsh/assistant/store.ts
import { fs, joinPath, logger } from "../native/runtime.mjs";
var V2_IDENTITY_LINE = "You are Jan, a helpful AI assistant who assists users with their requests. Jan is trained by Menlo Research (https://www.menlo.ai).";
function validateAssistantId(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) {
    throw new Error("Assistant ID must contain only letters, numbers, underscores, or hyphens (maximum 128 characters).");
  }
}
var Assistants = class {
  CURRENT_MIGRATION_VERSION = 3;
  MIGRATION_FILE = "file://assistants/.migration_version";
  fs = fs;
  log = logger;
  /** Creates the folder, migrates and seeds; must finish before use. */
  async prepare() {
    if (!await this.fs.existsSync("file://assistants")) {
      await this.fs.mkdir("file://assistants");
    }
    const firstUse = !await this.fs.existsSync(this.MIGRATION_FILE);
    await this.runMigrations();
    const assistants = await this.readAssistantsFromDisk();
    if (firstUse && assistants.length === 0) {
      const assistantWithParams = {
        ...this.defaultAssistant,
        parameters: {
          temperature: 0.7,
          top_k: 20,
          top_p: 0.8,
          repeat_penalty: 1.12
        }
      };
      await this.createAssistant(assistantWithParams);
    }
  }
  /**
   * Gets the current migration version from storage
   */
  async getCurrentMigrationVersion() {
    try {
      if (await this.fs.existsSync(this.MIGRATION_FILE)) {
        const versionStr = await this.fs.readFileSync(this.MIGRATION_FILE);
        const version = parseInt(versionStr.trim(), 10);
        return isNaN(version) ? 0 : version;
      }
    } catch (error) {
      this.log.error("Failed to read migration version:", error);
    }
    return 0;
  }
  /**
   * Saves the migration version to storage
   */
  async saveMigrationVersion(version) {
    try {
      await this.fs.writeFileSync(this.MIGRATION_FILE, version.toString());
    } catch (error) {
      this.log.error("Failed to save migration version:", error);
    }
  }
  /**
   * Runs all pending migrations
   */
  async runMigrations() {
    const currentVersion = await this.getCurrentMigrationVersion();
    if (currentVersion < 1) {
      this.log.info("Running migration v1: Update assistant instructions");
      await this.migrateAssistantInstructions();
      await this.saveMigrationVersion(1);
    }
    if (currentVersion < 2) {
      this.log.info("Running migration v2: Update to Menlo Research instructions");
      await this.migrateToMenloInstructions();
      await this.saveMigrationVersion(2);
    }
    if (currentVersion < 3) {
      this.log.info("Running migration v3: Strip identity preamble from default assistant");
      await this.migrateStripIdentityPreamble();
      await this.saveMigrationVersion(3);
    }
    this.log.info(
      `Migrations complete. Current version: ${this.CURRENT_MIGRATION_VERSION}`
    );
  }
  /**
   * Migration v1: Update assistant instructions from old format to new format
   */
  async migrateAssistantInstructions() {
    const OLD_INSTRUCTION = "You are a helpful AI assistant.";
    const NEW_INSTRUCTION = "You are Jan, a helpful AI assistant.";
    if (!await this.fs.existsSync("file://assistants")) {
      return;
    }
    const assistants = await this.getAssistants();
    for (const assistant of assistants) {
      if (assistant.instructions?.startsWith(OLD_INSTRUCTION)) {
        const restOfInstructions = assistant.instructions.substring(
          OLD_INSTRUCTION.length
        );
        assistant.instructions = NEW_INSTRUCTION + restOfInstructions;
        const assistantPath = await joinPath([
          "file://assistants",
          assistant.id,
          "assistant.json"
        ]);
        try {
          await this.fs.writeFileSync(
            assistantPath,
            JSON.stringify(assistant, null, 2)
          );
          this.log.info(`Migrated instructions for assistant: ${assistant.id}`);
        } catch (error) {
          this.log.error(`Failed to migrate assistant ${assistant.id}:`, error);
        }
      }
    }
  }
  /**
   * Migration v2: Update assistant instructions to Menlo Research format and set default parameters
   */
  async migrateToMenloInstructions() {
    const OLD_INSTRUCTION_PREFIX = "You are Jan, a helpful AI assistant.";
    const NEW_INSTRUCTION = `${V2_IDENTITY_LINE}

You must output your response in the exact language used in the latest user message. Do not provide translations or switch languages unless explicitly instructed to do so. If the input is mostly English, respond in English.

When handling user queries:

1. Think step by step about the query:
   - Break complex questions into smaller, searchable parts
   - Identify key search terms and parameters
   - Consider what information is needed to provide a complete answer

2. Mandatory logical analysis:
   - Before engaging any tools, articulate your complete thought process in natural language. You must act as a "professional tool caller," demonstrating rigorous logic.
   - Analyze the information gap: explicitly state what data is missing.
   - Derive the strategy: explain why a specific tool is the logical next step.
   - Justify parameters: explain why you chose those specific search keywords or that specific URL.

You have tools to search for and access real-time, up-to-date data. Use them. Search before stating that you can't or don't know.

Current date: {{current_date}}`;
    const DEFAULT_PARAMETERS = {
      temperature: 0.7,
      top_k: 20,
      top_p: 0.8,
      repeat_penalty: 1.12
    };
    if (!await this.fs.existsSync("file://assistants")) {
      return;
    }
    const assistants = await this.getAssistants();
    for (const assistant of assistants) {
      if (assistant.instructions?.startsWith(OLD_INSTRUCTION_PREFIX)) {
        assistant.instructions = NEW_INSTRUCTION;
        const assistantWithParams = {
          ...assistant,
          parameters: DEFAULT_PARAMETERS
        };
        const assistantPath = await joinPath([
          "file://assistants",
          assistant.id,
          "assistant.json"
        ]);
        try {
          await this.fs.writeFileSync(
            assistantPath,
            JSON.stringify(assistantWithParams, null, 2)
          );
          this.log.info(
            `Migrated to Menlo instructions for assistant: ${assistant.id}`
          );
        } catch (error) {
          this.log.error(`Failed to migrate assistant ${assistant.id}:`, error);
        }
      }
    }
  }
  /**
   * Migration v3: Strip the identity preamble from assistants whose instructions
   * are still the verbatim v2 default. Leaves user-customized prompts untouched.
   */
  async migrateStripIdentityPreamble() {
    if (!await this.fs.existsSync("file://assistants")) {
      return;
    }
    const expectedOldInstructions = `${V2_IDENTITY_LINE}

${this.defaultAssistant.instructions}`;
    const assistants = await this.getAssistants();
    for (const assistant of assistants) {
      if (assistant.instructions !== expectedOldInstructions) continue;
      assistant.instructions = this.defaultAssistant.instructions;
      const assistantPath = await joinPath([
        "file://assistants",
        assistant.id,
        "assistant.json"
      ]);
      try {
        await this.fs.writeFileSync(assistantPath, JSON.stringify(assistant, null, 2));
        this.log.info(`Stripped identity preamble for assistant: ${assistant.id}`);
      } catch (error) {
        this.log.error(`Failed to migrate assistant ${assistant.id}:`, error);
      }
    }
  }
  /** Read persisted assistants; prepare seeds the default on first use. */
  async readAssistantsFromDisk() {
    if (!await this.fs.existsSync("file://assistants")) return [];
    const assistants = await this.fs.readdirSync("file://assistants");
    const assistantsData = [];
    for (const entry of assistants) {
      const assistant = entry.replaceAll("\\", "/").split("/").pop() ?? "";
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(assistant)) continue;
      const assistantPath = await joinPath([
        "file://assistants",
        assistant,
        "assistant.json"
      ]);
      if (!await this.fs.existsSync(assistantPath)) continue;
      try {
        const assistantData = JSON.parse(await this.fs.readFileSync(assistantPath));
        if (assistantData?.id !== assistant) {
          this.log.error(`Assistant identity does not match its folder: ${assistant}`);
          continue;
        }
        assistantsData.push(assistantData);
      } catch (error) {
        this.log.error(`Failed to read assistant ${assistant}:`, error);
      }
    }
    return assistantsData;
  }
  async getAssistants() {
    return this.readAssistantsFromDisk();
  }
  async createAssistant(assistant) {
    validateAssistantId(assistant.id);
    const assistantPath = await joinPath([
      "file://assistants",
      assistant.id,
      "assistant.json"
    ]);
    const assistantFolder = await joinPath(["file://assistants", assistant.id]);
    if (!await this.fs.existsSync(assistantFolder)) {
      await this.fs.mkdir(assistantFolder);
    }
    await this.fs.writeFileSync(assistantPath, JSON.stringify(assistant, null, 2));
  }
  async deleteAssistant(assistant) {
    validateAssistantId(assistant.id);
    const assistantPath = await joinPath([
      "file://assistants",
      assistant.id,
      "assistant.json"
    ]);
    if (await this.fs.existsSync(assistantPath)) {
      await this.fs.rm(assistantPath);
    }
  }
  defaultAssistant = {
    avatar: "\u{1F44B}",
    thread_location: void 0,
    id: "jan",
    object: "assistant",
    created_at: Date.now() / 1e3,
    name: "Jan",
    description: "Jan is a helpful desktop assistant that can reason through complex tasks and use tools to complete them on the user\u2019s behalf.",
    model: "*",
    instructions: `You must output your response in the exact language used in the latest user message. Do not provide translations or switch languages unless explicitly instructed to do so. If the input is mostly English, respond in English.

When handling user queries:

1. Think step by step about the query:
   - Break complex questions into smaller, searchable parts
   - Identify key search terms and parameters
   - Consider what information is needed to provide a complete answer

2. Mandatory logical analysis:
   - Before engaging any tools, articulate your complete thought process in natural language. You must act as a "professional tool caller," demonstrating rigorous logic.
   - Analyze the information gap: explicitly state what data is missing.
   - Derive the strategy: explain why a specific tool is the logical next step.
   - Justify parameters: explain why you chose those specific search keywords or that specific URL.

You have tools to search for and access real-time, up-to-date data. Use them. Search before stating that you can't or don't know.

Current date: {{current_date}}`,
    tools: [
      {
        type: "retrieval",
        enabled: false,
        useTimeWeightedRetriever: false,
        settings: {
          top_k: 2,
          chunk_size: 1024,
          chunk_overlap: 64,
          retrieval_template: `Use the following pieces of context to answer the question at the end.
----------------
CONTEXT: {CONTEXT}
----------------
QUESTION: {QUESTION}
----------------
Helpful Answer:`
        }
      }
    ],
    file_ids: [],
    metadata: void 0
  };
};

// dsh/assistant/host.ts
var name = "ow-assistant";
var inject = ["owNative", "webServer", "connection", "agents"];
async function apply(ctx) {
  const store = new Assistants();
  const assignmentFile = "file://assistants/.session_assignments.json";
  const assignments = /* @__PURE__ */ Object.create(null);
  const registrations = /* @__PURE__ */ new Map();
  let preparation;
  let writes = Promise.resolve();
  const prepare = () => preparation ??= (async () => {
    await store.prepare();
    if (await fs2.existsSync(assignmentFile)) {
      const saved = JSON.parse(await fs2.readFileSync(assignmentFile));
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
        throw new Error("Saved assistant session assignments are invalid.");
      }
      for (const [sessionId, value] of Object.entries(saved)) {
        if (!value || typeof value !== "object") continue;
        const assignment = value;
        if (typeof assignment.assistantId !== "string" || typeof assignment.instructions !== "string") continue;
        validateAssistantId(assignment.assistantId);
        assignments[sessionId] = assignment;
      }
    }
    for (const agent of ctx.agents.list()) {
      const assignment = assignments[agent.id];
      if (assignment) install(agent, assignment);
    }
  })().catch((error) => {
    preparation = void 0;
    throw error;
  });
  const install = (agent, assignment) => {
    const current = registrations.get(agent);
    if (current) {
      current.assignment = assignment;
      return;
    }
    const entry = {
      assignment, dispose: () => {
      }
    };
    entry.dispose = agent.ctx.systemPrompt.section({
      name: "open-waifu.assistant",
      order: agent.ctx.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_PREFIX"),
      interpolate: false,
      text: () => entry.assignment.instructions.replaceAll("{{current_date}}", (/* @__PURE__ */ new Date()).toISOString().slice(0, 10))
    });
    registrations.set(agent, entry);
  };
  ctx.on("agent/created", async ({ agent }) => {
    await prepare();
    const assignment = assignments[agent.id];
    if (assignment) install(agent, assignment);
  });
  ctx.on("agent/disposed", ({ agent }) => {
    registrations.delete(agent);
  });
  ctx.effect(() => () => {
    for (const entry of registrations.values()) entry.dispose();
    registrations.clear();
  }, "ow-assistant: session instructions");
  const text = (value, label, max) => {
    if (typeof value !== "string" || value.length > max) {
      throw new Error(`${label} must be text no longer than ${max} characters.`);
    }
    return value;
  };
  const find = async (id) => {
    validateAssistantId(id);
    await prepare();
    const assistant = (await store.getAssistants()).find((item) => item.id === id);
    if (!assistant) throw new Error("Assistant no longer exists. Refresh the list and try again.");
    return assistant;
  };
  const service = {
    async list(_params) {
      await prepare();
      return store.getAssistants();
    },
    async save({ assistant: input }) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected an assistant object.");
      const value = input;
      validateAssistantId(value.id);
      const assistantName = text(value.name, "Name", 200).trim();
      if (!assistantName) throw new Error("Enter a name for this assistant.");
      const description = text(value.description ?? "", "Description", 4e3);
      const instructions = text(value.instructions ?? "", "Instructions", 262144);
      await prepare();
      const existing = (await store.getAssistants()).find((item) => item.id === value.id);
      const assistant = {
        ...existing,
        id: value.id,
        object: "assistant",
        created_at: existing?.created_at ?? Date.now() / 1e3,
        model: existing?.model ?? "*",
        name: assistantName,
        description,
        instructions
      };
      await store.createAssistant(assistant);
      return assistant;
    },
    async remove({ id, confirmed }) {
      if (confirmed !== true) throw new Error("Confirm deletion before removing an assistant.");
      const assistant = await find(id);
      await store.deleteAssistant(assistant);
      return { id: assistant.id };
    },
    async getAssignment({ sessionId }) {
      if (typeof sessionId !== "string" || !sessionId) throw new Error("Select a running DSH session.");
      await prepare();
      const assignment = assignments[sessionId];
      if (!assignment) return null;
      const assistant = (await store.getAssistants()).find((item) => item.id === assignment.assistantId);
      return { id: assignment.assistantId, name: assistant?.name ?? null };
    },
    async apply({ id, sessionId }) {
      const assistant = await find(id);
      if (typeof sessionId !== "string" || !sessionId) throw new Error("Select a running DSH session.");
      const agent = ctx.agents.get(sessionId);
      if (!agent) throw new Error("This session is not loaded. Open the conversation, then try again.");
      if (agent.session.header.origin === "subagent") throw new Error("Choose a conversation rather than a subagent session.");
      if (agent.status !== "idle") throw new Error("Wait for the session to finish its current turn before applying an assistant.");
      const assignment = { assistantId: assistant.id, instructions: assistant.instructions ?? "" };
      const operation = writes.then(() => agent.runMaintenance(async (signal) => {
        signal.throwIfAborted();
        if (ctx.agents.get(agent.id) !== agent) throw new Error("The selected session was closed. Open it and try again.");
        const saved = { ...assignments, [sessionId]: assignment };
        await fs2.writeFileSync(assignmentFile, JSON.stringify(saved, null, 2));
        assignments[sessionId] = assignment;
        install(agent, assignment);
        return { assistantId: assistant.id, sessionId };
      }));
      writes = operation.then(() => {
      }, () => {
      });
      return operation;
    }
  };
  await prepare();
  ctx.provide("owAssistant", service);
  ctx.effect(() => registerApi(ctx, "assistant", service), "ow-assistant: API");
}
export {
  apply,
  inject,
  name
};
