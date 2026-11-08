// Tiny request/response wrapper around a forked child process.
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

export function startWorker(relPath, name) {
  const file = fileURLToPath(new URL(relPath, import.meta.url));
  let child = null;
  let nextId = 1;
  const pending = new Map();

  function spawn() {
    child = fork(file, [], { serialization: "advanced", stdio: ["ignore", "ignore", "pipe", "ipc"] });
    child.stderr.on("data", () => {}); // model libraries print noisy warnings
    child.on("message", (m) => {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error)) : p.resolve(m);
    });
    child.on("exit", (code) => {
      for (const p of pending.values()) p.reject(new Error(`${name} worker exited (${code})`));
      pending.clear();
      child = null;
    });
  }

  return {
    request(msg) {
      if (!child) spawn();
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.send({ ...msg, id });
      });
    },
  };
}
