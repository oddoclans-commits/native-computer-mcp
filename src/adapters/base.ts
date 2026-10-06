import type { ComputerAdapter } from "../types.js";

export abstract class BaseComputerAdapter implements ComputerAdapter {
  abstract readonly platform: ComputerAdapter["platform"];
  abstract readonly name: string;

  abstract status(): Promise<Awaited<ReturnType<ComputerAdapter["status"]>>>;
  abstract start(): Promise<void>;
  abstract observe(): Promise<Awaited<ReturnType<ComputerAdapter["observe"]>>>;
  abstract act(
    request: Parameters<ComputerAdapter["act"]>[0]
  ): Promise<Awaited<ReturnType<ComputerAdapter["act"]>>>;
  abstract stop(): Promise<void>;
}
