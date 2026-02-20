"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  DEMO_ORG_NAME,
  DEMO_SYSTEM_PROMPT,
  DEMO_DOCUMENTS,
  DEMO_EVAL_TEST_CASES,
} from "@/lib/demo/content";

async function getAuthUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  return { user };
}

export type DemoStatus = {
  exists: boolean;
  orgId: string | null;
  orgName: string | null;
  documentCount: number;
  conversationCount: number;
  evalTestSetCount: number;
};

export async function getDemoStatus(): Promise<DemoStatus> {
  await getAuthUser();
  const admin = createAdminClient();

  const { data: demoOrg } = await admin
    .from("organizations")
    .select("id, name")
    .eq("is_demo", true)
    .limit(1)
    .single();

  if (!demoOrg) {
    return {
      exists: false,
      orgId: null,
      orgName: null,
      documentCount: 0,
      conversationCount: 0,
      evalTestSetCount: 0,
    };
  }

  const [docs, convs, evalSets] = await Promise.all([
    admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", demoOrg.id),
    admin
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", demoOrg.id),
    admin
      .from("eval_test_sets")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", demoOrg.id),
  ]);

  return {
    exists: true,
    orgId: demoOrg.id,
    orgName: demoOrg.name,
    documentCount: docs.count ?? 0,
    conversationCount: convs.count ?? 0,
    evalTestSetCount: evalSets.count ?? 0,
  };
}

export async function seedDemo() {
  const { user } = await getAuthUser();
  const admin = createAdminClient();

  // Check if demo already exists
  const { data: existing } = await admin
    .from("organizations")
    .select("id")
    .eq("is_demo", true)
    .limit(1)
    .single();

  if (existing) {
    return { error: "Demo data already exists. Delete it first to re-seed." };
  }

  // 1. Create demo org
  const slug = "sunrise-properties-demo";
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: DEMO_ORG_NAME,
      slug,
      system_prompt: DEMO_SYSTEM_PROMPT,
      is_demo: true,
    })
    .select("id")
    .single();

  if (orgError || !org) {
    console.error("Failed to create demo org:", orgError);
    return { error: "Failed to create demo organization" };
  }

  // 2. Add current user as owner
  const { error: memberError } = await admin
    .from("organization_members")
    .insert({
      organization_id: org.id,
      user_id: user.id,
      role: "owner",
    });

  if (memberError) {
    console.error("Failed to add user to demo org:", memberError);
    await admin.from("organizations").delete().eq("id", org.id);
    return { error: "Failed to add user to demo organization" };
  }

  // 3. Upload demo documents
  for (const doc of DEMO_DOCUMENTS) {
    const documentId = crypto.randomUUID();
    const storagePath = `${org.id}/${documentId}/${doc.name}`;
    const buffer = new TextEncoder().encode(doc.content);

    // Compute content hash
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const contentHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Upload to storage
    const { error: uploadError } = await admin.storage
      .from("documents")
      .upload(storagePath, buffer, { contentType: doc.mimeType });

    if (uploadError) {
      console.error(`Failed to upload ${doc.name}:`, uploadError);
      continue;
    }

    // Create document record
    const { error: insertError } = await admin.from("documents").insert({
      id: documentId,
      organization_id: org.id,
      uploaded_by: user.id,
      name: doc.name,
      storage_path: storagePath,
      mime_type: doc.mimeType,
      file_size: buffer.byteLength,
      content_hash: contentHash,
    });

    if (insertError) {
      console.error(`Failed to insert document ${doc.name}:`, insertError);
      continue;
    }

    // Enqueue ingestion
    const { error: queueError } = await admin.rpc("enqueue_ingestion", {
      p_document_id: documentId,
    });

    if (queueError) {
      console.error(`Failed to enqueue ${doc.name}:`, queueError);
    }
  }

  // 4. Seed eval test set
  const { data: testSet } = await admin
    .from("eval_test_sets")
    .insert({
      organization_id: org.id,
      name: "PropTech Demo",
      description:
        "Evaluation test cases for the PropTech demo covering lease, HOA, and community document Q&A.",
    })
    .select("id")
    .single();

  if (testSet) {
    const testCaseRows = DEMO_EVAL_TEST_CASES.map((tc) => ({
      test_set_id: testSet.id,
      question: tc.question,
      expected_answer: tc.expected_answer,
    }));

    await admin.from("eval_test_cases").insert(testCaseRows);
  }

  // 5. Switch user to demo org
  await admin
    .from("profiles")
    .update({ current_organization_id: org.id })
    .eq("id", user.id);

  revalidatePath("/admin");
  revalidatePath("/documents");
  revalidatePath("/chat");
  revalidatePath("/eval");
  return { success: true, orgId: org.id };
}

export async function deleteDemo() {
  const { user } = await getAuthUser();
  const admin = createAdminClient();

  // Find demo org
  const { data: demoOrg } = await admin
    .from("organizations")
    .select("id")
    .eq("is_demo", true)
    .limit(1)
    .single();

  if (!demoOrg) {
    return { error: "No demo data found" };
  }

  // 1. Delete storage objects
  const { data: docs } = await admin
    .from("documents")
    .select("storage_path")
    .eq("organization_id", demoOrg.id);

  if (docs && docs.length > 0) {
    const paths = docs.map((d) => d.storage_path);
    await admin.storage.from("documents").remove(paths);
  }

  // 2. If user's current org is the demo org, switch to another
  const { data: profile } = await admin
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .single();

  if (profile?.current_organization_id === demoOrg.id) {
    const { data: otherMembership } = await admin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .neq("organization_id", demoOrg.id)
      .limit(1)
      .single();

    await admin
      .from("profiles")
      .update({
        current_organization_id: otherMembership?.organization_id ?? null,
      })
      .eq("id", user.id);
  }

  // 3. Delete the org — cascades everything
  const { error } = await admin
    .from("organizations")
    .delete()
    .eq("id", demoOrg.id);

  if (error) {
    console.error("Failed to delete demo org:", error);
    return { error: "Failed to delete demo data" };
  }

  revalidatePath("/admin");
  revalidatePath("/documents");
  revalidatePath("/chat");
  revalidatePath("/eval");
  return { success: true };
}
