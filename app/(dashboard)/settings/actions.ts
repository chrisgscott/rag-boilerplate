"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DEFAULT_MODEL_RATES } from "@/lib/rag/cost";

async function getCurrentOrg() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .single();

  if (!profile?.current_organization_id) {
    throw new Error("No active organization");
  }

  return { supabase, user, organizationId: profile.current_organization_id };
}

export type ModelRate = {
  id: string;
  model_id: string;
  input_rate: number;
  output_rate: number;
  embedding_rate: number | null;
  updated_at: string;
};

export async function getModelRates(): Promise<ModelRate[]> {
  const { supabase } = await getCurrentOrg();

  const { data, error } = await supabase
    .from("model_rates")
    .select("id, model_id, input_rate, output_rate, embedding_rate, updated_at")
    .order("model_id");

  if (error) throw new Error("Failed to load model rates");

  return (data ?? []).map((r) => ({
    id: r.id,
    model_id: r.model_id,
    input_rate: Number(r.input_rate),
    output_rate: Number(r.output_rate),
    embedding_rate: r.embedding_rate ? Number(r.embedding_rate) : null,
    updated_at: r.updated_at,
  }));
}

export async function upsertModelRate(formData: FormData) {
  const { supabase, organizationId } = await getCurrentOrg();

  const modelId = formData.get("model_id") as string;
  const inputRate = parseFloat(formData.get("input_rate") as string);
  const outputRate = parseFloat(formData.get("output_rate") as string);
  const embeddingRateStr = formData.get("embedding_rate") as string;
  const embeddingRate = embeddingRateStr ? parseFloat(embeddingRateStr) : null;

  if (!modelId || isNaN(inputRate) || isNaN(outputRate)) {
    return { error: "Invalid input" };
  }

  const { error } = await supabase.from("model_rates").upsert(
    {
      organization_id: organizationId,
      model_id: modelId,
      input_rate: inputRate,
      output_rate: outputRate,
      embedding_rate: embeddingRate,
    },
    { onConflict: "organization_id,model_id" }
  );

  if (error) {
    console.error("Upsert model rate failed:", error);
    return { error: "Failed to save model rate" };
  }

  revalidatePath("/settings");
  return { success: true };
}

export async function deleteModelRate(rateId: string) {
  const { supabase } = await getCurrentOrg();

  const { error } = await supabase
    .from("model_rates")
    .delete()
    .eq("id", rateId);

  if (error) {
    return { error: "Failed to delete model rate" };
  }

  revalidatePath("/settings");
  return { success: true };
}

export async function seedDefaultRates() {
  const { supabase, organizationId } = await getCurrentOrg();

  const rows = Object.entries(DEFAULT_MODEL_RATES).map(([modelId, rates]) => ({
    organization_id: organizationId,
    model_id: modelId,
    input_rate: rates.input_rate,
    output_rate: rates.output_rate,
    embedding_rate: rates.embedding_rate,
  }));

  const { error } = await supabase
    .from("model_rates")
    .upsert(rows, { onConflict: "organization_id,model_id" });

  if (error) {
    return { error: "Failed to seed default rates" };
  }

  revalidatePath("/settings");
  return { success: true };
}

export async function getSystemPrompt(): Promise<string | null> {
  const { supabase, organizationId } = await getCurrentOrg();

  const { data } = await supabase
    .from("organizations")
    .select("system_prompt")
    .eq("id", organizationId)
    .single();

  return data?.system_prompt ?? null;
}

export async function updateSystemPrompt(prompt: string | null) {
  const { supabase, organizationId } = await getCurrentOrg();

  const { error } = await supabase
    .from("organizations")
    .update({ system_prompt: prompt || null })
    .eq("id", organizationId);

  if (error) {
    console.error("Update system prompt failed:", error);
    return { error: "Failed to update system prompt" };
  }

  revalidatePath("/settings");
  return { success: true };
}

// --- API Key Management ---

export type ApiKeyData = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
};

export async function getApiKeys(): Promise<ApiKeyData[]> {
  const { supabase } = await getCurrentOrg();

  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, last_used_at, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error("Failed to load API keys");

  return (data ?? []).map((k) => ({
    id: k.id,
    name: k.name,
    keyPrefix: k.key_prefix,
    lastUsedAt: k.last_used_at,
    createdAt: k.created_at,
  }));
}

export async function createApiKey(
  name: string
): Promise<{ key: string } | { error: string }> {
  const { supabase, organizationId } = await getCurrentOrg();

  if (!name?.trim()) return { error: "Name is required" };

  // Generate key: sk-<32 random hex chars>
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const hex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const key = `sk-${hex}`;
  const keyPrefix = key.substring(0, 10); // "sk-" + first 7 hex chars

  // Hash the key
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(key));
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { error } = await supabase.from("api_keys").insert({
    organization_id: organizationId,
    name: name.trim(),
    key_hash: keyHash,
    key_prefix: keyPrefix,
  });

  if (error) return { error: "Failed to create API key" };

  revalidatePath("/settings");
  return { key };
}

export async function revokeApiKey(keyId: string) {
  const { supabase } = await getCurrentOrg();

  const { error } = await supabase.from("api_keys").delete().eq("id", keyId);

  if (error) return { error: "Failed to revoke API key" };

  revalidatePath("/settings");
  return { success: true };
}
