import { InsomniaClient } from "../mod.ts";

const ask = async (question: string) => {
  const buf = new Uint8Array(1024);
  await Deno.stdout.write(new TextEncoder().encode(`${question.trim()}`));
  return new TextDecoder().decode(
    buf.subarray(0, <number> await Deno.stdin.read(buf)),
  ).trim();
};

const formatMessage = (username: string, message: string) =>
  `${username} : ${message}`;

const client = new InsomniaClient("localhost:6020");

const username = await ask("username: ");

client.login(
  { username: "root", password: "root" },
  // deno-lint-ignore no-explicit-any
  async (success: any, data: any) => {
    if (!success) throw new Error(JSON.stringify(data));
    const room = await ask("room name: ");
    const record = client.record.getRecord(room);
    record.subscribe("last-message", (value: string) => {
      if (!value.startsWith(`${username}`)) console.log(value);
    });
    while (true) {
      // deno-lint-ignore no-explicit-any
      record.set(`last-message`, formatMessage(username, await ask(``)) as any);
    }
  },
);
