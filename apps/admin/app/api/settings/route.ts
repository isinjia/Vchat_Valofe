import { NextRequest, NextResponse } from "next/server";
import {
  getSetting,
  setSetting,
  getLlmSettings,
  DEFAULT_LLM_SETTINGS,
  type StorageSettings,
} from "@vchatbot/core";

export async function GET() {
  const [storage, llm] = await Promise.all([
    getSetting<StorageSettings>("storage"),
    getLlmSettings(),
  ]);
  return NextResponse.json({ storage, llm: llm ?? DEFAULT_LLM_SETTINGS });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  if (body.storage) await setSetting("storage", body.storage);
  if (body.llm) await setSetting("llm", body.llm);
  return NextResponse.json({ ok: true });
}
