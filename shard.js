// shard base
import { BaseClusterWorker } from "eris-fleet";
// path stuff
import { readdir } from "fs/promises";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
// fancy loggings
import { log, error } from "./utils/logger.js";
// initialize command loader
import { load, update } from "./utils/handler.js";
// lavalink stuff
import { checkStatus, connect, reload, status, connected } from "./utils/soundplayer.js";
// database stuff
import database from "./utils/database.js";
// command collections
import { paths } from "./utils/collections.js";
// playing messages
const { messages } = JSON.parse(readFileSync(new URL("./config/messages.json", import.meta.url)));
// command config
const { types } = JSON.parse(readFileSync(new URL("./config/commands.json", import.meta.url)));
// other stuff
import { random } from "./utils/misc.js";
// generate help page
import { generateList, createPage } from "./utils/help.js";
// whether a broadcast is currently in effect
let broadcast = false;

class Shard extends BaseClusterWorker {
  constructor(bot) {
    super(bot);

    console.info = (str) => this.ipc.sendToAdmiral("info", str);
    this.playingSuffix = types.classic ? ` | @${this.bot.user.username} help` : "";
    this.init();
  }

  async init() {
    if (!types.classic && !types.application) {
      error("Both classic and application commands are disabled! Please enable at least one command type in config/commands.json.");
      this.ipc.totalShutdown(true);
      return;
    }
    // register commands and their info
    const soundStatus = await checkStatus();
    log("info", "Attempting to load commands...");
    for await (const commandFile of this.getFiles(resolve(dirname(fileURLToPath(import.meta.url)), "./commands/"))) {
      log("log", `Loading command from ${commandFile}...`);
      try {
        await load(this.bot, this.clusterID, this.workerID, this.ipc, commandFile, soundStatus);
      } catch (e) {
        error(`Failed to register command from ${commandFile}: ${e}`);
      }
    }
    if (types.application) {
      const commandArray = await update(this.bot, this.clusterID, this.workerID, this.ipc, soundStatus);
      try {
        log("info", "Sending application command data to Discord...");
        let cmdArray = commandArray.main;
        if (process.env.ADMIN_SERVER && process.env.ADMIN_SERVER !== "") {
          await this.bot.bulkEditGuildCommands(process.env.ADMIN_SERVER, commandArray.private);
        } else {
          cmdArray = [...commandArray.main, ...commandArray.private];
        }
        await this.bot.bulkEditCommands(cmdArray);
      } catch (e) {
        log("error", e);
        log("error", "Failed to send command data to Discord, slash/message commands may be unavailable.");
      }
    }
    log("info", "Finished loading commands.");

    await database.setup(this.ipc);

    // register events
    log("info", "Attempting to load events...");
    for await (const file of this.getFiles(resolve(dirname(fileURLToPath(import.meta.url)), "./events/"))) {
      log("log", `Loading event from ${file}...`);
      const eventArray = file.split("/");
      const eventName = eventArray[eventArray.length - 1].split(".")[0];
      if (eventName === "messageCreate" && !types.classic) {
        log("warn", `Skipped loading event from ${file} because classic commands are disabled...`);
        continue;
      } else if (eventName === "interactionCreate" && !types.application) {
        log("warn", `Skipped loading event from ${file} because application commands are disabled`);
        continue;
      }
      const { default: event } = await import(file);
      this.bot.on(eventName, event.bind(null, this.bot, this.clusterID, this.workerID, this.ipc));
    }
    log("info", "Finished loading events.");

    // generate docs
    if (process.env.OUTPUT && process.env.OUTPUT !== "") {
      await generateList();
      if (this.clusterID === 0) {
        await createPage(process.env.OUTPUT);
        log("info", "The help docs have been generated.");
      }
    }

    this.ipc.register("reload", async (message) => {
      const path = paths.get(message);
      if (!path) return this.ipc.broadcast("reloadFail", { result: "I couldn't find that command!" });
      const result = await load(this.bot, this.clusterID, this.workerID, this.ipc, path, await checkStatus(), true);
      if (result !== message) return this.ipc.broadcast("reloadFail", { result });
      return this.ipc.broadcast("reloadSuccess");
    });

    this.ipc.register("soundreload", async () => {
      const soundStatus = await checkStatus();
      if (!soundStatus) {
        const length = reload();
        return this.ipc.broadcast("soundReloadSuccess", { length });
      } else {
        return this.ipc.broadcast("soundReloadFail");
      }
    });

    this.ipc.register("playbroadcast", (message) => {
      this.bot.editStatus("dnd", {
        name: message + this.playingSuffix,
      });
      broadcast = true;
      return this.ipc.broadcast("broadcastSuccess");
    });

    this.ipc.register("broadcastend", () => {
      this.bot.editStatus("dnd", {
        name: random(messages) + this.playingSuffix,
      });
      broadcast = false;
      return this.ipc.broadcast("broadcastEnd");
    });

    // connect to lavalink
    if (!status && !connected) connect(this.bot);

    const broadcastMessage = await this.ipc.centralStore.get("broadcast");
    if (broadcastMessage) {
      broadcast = true;
      this.bot.editStatus("dnd", {
        name: broadcastMessage + this.playingSuffix,
      });
    }

    this.activityChanger();

    log("info", `Started worker ${this.workerID}.`);
  }

  // set activity (a.k.a. the gamer code)
  activityChanger() {
    if (!broadcast) {
      this.bot.editStatus("dnd", {
        name: random(messages) + this.playingSuffix,
      });
    }
    setTimeout(this.activityChanger.bind(this), 900000);
  }

  async* getFiles(dir) {
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      const name = dir + (dir.charAt(dir.length - 1) !== "/" ? "/" : "") + dirent.name;
      if (dirent.isDirectory()) {
        yield* this.getFiles(name);
      } else if (dirent.name.endsWith(".js")) {
        yield name;
      }
    }
  }

  shutdown(done) {
    log("warn", "Shutting down...");
    this.bot.editStatus("dnd", {
      name: "Restarting/shutting down..."
    });
    database.stop();
    done();
  }

}

export default Shard;
