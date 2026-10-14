import type { ClientMessage, ServerMessage } from "@borderfall/protocol";

export interface NetHandlers {
  onOpen(): void;
  onMessage(message: ServerMessage): void;
  onClose(): void;
}

export function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) return configured;
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws`;
}

export class Net {
  private readonly ws: WebSocket;

  constructor(url: string, handlers: NetHandlers) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener("open", () => handlers.onOpen());
    this.ws.addEventListener("message", (e) =>
      handlers.onMessage(JSON.parse(e.data as string) as ServerMessage),
    );
    this.ws.addEventListener("close", () => handlers.onClose());
  }

  send(message: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  close(): void {
    this.ws.close();
  }
}
