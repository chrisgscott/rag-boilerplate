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
