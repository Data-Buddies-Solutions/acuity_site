import type { ChatHistoryItem } from "@/lib/call-types";

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function getChatItemCallId(item: ChatHistoryItem): string | undefined {
  return stringValue(item.call_id);
}

export function getChatItemCreatedAt(item: ChatHistoryItem): number | undefined {
  return numberValue(item.created_at);
}

export function getChatItemToolArgs(item: ChatHistoryItem): string {
  return stringValue(item.arguments) ?? "";
}

export function getChatItemIsError(item: ChatHistoryItem): boolean {
  return booleanValue(item.is_error) ?? false;
}
