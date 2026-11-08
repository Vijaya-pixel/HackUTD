export type InboundHandler = (from: string, text: string, sessionId?: string) => Promise<void>;

export interface MessagingChannel {
  /** Send a message to a phone number or user ID */
  send(to: string, text: string, sessionId?: string): Promise<void>;
  /** Register a handler for inbound messages */
  onMessage(handler: InboundHandler): void;
  /** Start the channel (connect, start polling, etc.) */
  start(): Promise<void>;
  /** Graceful shutdown */
  stop(): Promise<void>;
}
