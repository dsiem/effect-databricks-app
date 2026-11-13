import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "dev:server"], { stdio: "inherit" }),
  spawn("npm", ["run", "dev:client"], { stdio: "inherit" }),
];
const stop = () => {
  for (const child of children) child.kill("SIGTERM");
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
for (const child of children)
  child.once("exit", (code) => {
    stop();
    process.exitCode = code ?? 0;
  });
