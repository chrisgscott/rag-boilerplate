export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      conversations: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          title: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_access_logs: {
        Row: {
          chunks_returned: number | null
          created_at: string
          document_id: string | null
          id: number
          organization_id: string
          query_text: string | null
          user_id: string | null
        }
        Insert: {
          chunks_returned?: number | null
          created_at?: string
          document_id?: string | null
          id?: never
          organization_id: string
          query_text?: string | null
          user_id?: string | null
        }
        Update: {
          chunks_returned?: number | null
          created_at?: string
          document_id?: string | null
          id?: never
          organization_id?: string
          query_text?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_access_logs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_access_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          fts: unknown
          id: number
          metadata: Json | null
          organization_id: string
          token_count: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          fts?: unknown
          id?: never
          metadata?: Json | null
          organization_id: string
          token_count?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          fts?: unknown
          id?: never
          metadata?: Json | null
          organization_id?: string
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          chunk_count: number | null
          content_hash: string | null
          created_at: string
          error_message: string | null
          file_size: number | null
          id: string
          metadata: Json | null
          mime_type: string
          name: string
          organization_id: string
          status: string
          storage_path: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          chunk_count?: number | null
          content_hash?: string | null
          created_at?: string
          error_message?: string | null
          file_size?: number | null
          id?: string
          metadata?: Json | null
          mime_type: string
          name: string
          organization_id: string
          status?: string
          storage_path: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          chunk_count?: number | null
          content_hash?: string | null
          created_at?: string
          error_message?: string | null
          file_size?: number | null
          id?: string
          metadata?: Json | null
          mime_type?: string
          name?: string
          organization_id?: string
          status?: string
          storage_path?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_results: {
        Row: {
          avg_completeness: number | null
          avg_faithfulness: number | null
          avg_relevance: number | null
          config: Json
          created_at: string
          error_message: string | null
          id: string
          mrr: number | null
          organization_id: string
          per_case_results: Json | null
          precision_at_k: number | null
          recall_at_k: number | null
          status: string
          test_set_id: string
        }
        Insert: {
          avg_completeness?: number | null
          avg_faithfulness?: number | null
          avg_relevance?: number | null
          config?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          mrr?: number | null
          organization_id: string
          per_case_results?: Json | null
          precision_at_k?: number | null
          recall_at_k?: number | null
          status?: string
          test_set_id: string
        }
        Update: {
          avg_completeness?: number | null
          avg_faithfulness?: number | null
          avg_relevance?: number | null
          config?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          mrr?: number | null
          organization_id?: string
          per_case_results?: Json | null
          precision_at_k?: number | null
          recall_at_k?: number | null
          status?: string
          test_set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eval_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_results_test_set_id_fkey"
            columns: ["test_set_id"]
            isOneToOne: false
            referencedRelation: "eval_test_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_test_cases: {
        Row: {
          created_at: string
          expected_answer: string | null
          expected_source_ids: string[] | null
          id: string
          question: string
          test_set_id: string
        }
        Insert: {
          created_at?: string
          expected_answer?: string | null
          expected_source_ids?: string[] | null
          id?: string
          question: string
          test_set_id: string
        }
        Update: {
          created_at?: string
          expected_answer?: string | null
          expected_source_ids?: string[] | null
          id?: string
          question?: string
          test_set_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eval_test_cases_test_set_id_fkey"
            columns: ["test_set_id"]
            isOneToOne: false
            referencedRelation: "eval_test_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_test_sets: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eval_test_sets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_feedback: {
        Row: {
          comment: string | null
          converted_to_test_case_id: string | null
          created_at: string
          id: string
          message_id: number
          organization_id: string
          rating: number
          user_id: string
        }
        Insert: {
          comment?: string | null
          converted_to_test_case_id?: string | null
          created_at?: string
          id?: string
          message_id: number
          organization_id: string
          rating: number
          user_id: string
        }
        Update: {
          comment?: string | null
          converted_to_test_case_id?: string | null
          created_at?: string
          id?: string
          message_id?: number
          organization_id?: string
          rating?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_feedback_converted_to_test_case_id_fkey"
            columns: ["converted_to_test_case_id"]
            isOneToOne: false
            referencedRelation: "eval_test_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_feedback_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_feedback_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: number
          model: string | null
          parent_message_id: number | null
          parts: Json | null
          role: string
          sources: Json | null
          token_count: number | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: never
          model?: string | null
          parent_message_id?: number | null
          parts?: Json | null
          role: string
          sources?: Json | null
          token_count?: number | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: never
          model?: string | null
          parent_message_id?: number | null
          parts?: Json | null
          role?: string
          sources?: Json | null
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      model_rates: {
        Row: {
          created_at: string
          embedding_rate: number | null
          id: string
          input_rate: number
          model_id: string
          organization_id: string
          output_rate: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          embedding_rate?: number | null
          id?: string
          input_rate?: number
          model_id: string
          organization_id: string
          output_rate?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          embedding_rate?: number | null
          id?: string
          input_rate?: number
          model_id?: string
          organization_id?: string
          output_rate?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          organization_id: string
          role: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          is_demo: boolean
          name: string
          slug: string
          system_prompt: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_demo?: boolean
          name: string
          slug: string
          system_prompt?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_demo?: boolean
          name?: string
          slug?: string
          system_prompt?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          current_organization_id: string | null
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          current_organization_id?: string | null
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          current_organization_id?: string | null
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_current_organization_id_fkey"
            columns: ["current_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_logs: {
        Row: {
          chunks_retrieved: number | null
          created_at: string
          embedding_cost: number | null
          embedding_tokens: number | null
          id: number
          llm_cost: number | null
          llm_input_tokens: number | null
          llm_output_tokens: number | null
          model: string | null
          organization_id: string
          query_text: string | null
          total_cost: number | null
          user_id: string | null
        }
        Insert: {
          chunks_retrieved?: number | null
          created_at?: string
          embedding_cost?: number | null
          embedding_tokens?: number | null
          id?: never
          llm_cost?: number | null
          llm_input_tokens?: number | null
          llm_output_tokens?: number | null
          model?: string | null
          organization_id: string
          query_text?: string | null
          total_cost?: number | null
          user_id?: string | null
        }
        Update: {
          chunks_retrieved?: number | null
          created_at?: string
          embedding_cost?: number | null
          embedding_tokens?: number | null
          id?: never
          llm_cost?: number | null
          llm_input_tokens?: number | null
          llm_output_tokens?: number | null
          model?: string | null
          organization_id?: string
          query_text?: string | null
          total_cost?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_stale_ingestion_jobs: { Args: never; Returns: undefined }
      enqueue_ingestion: { Args: { p_document_id: string }; Returns: number }
      get_user_organizations: { Args: never; Returns: string[] }
      hybrid_search: {
        Args: {
          filter_document_ids?: string[]
          full_text_weight?: number
          match_count?: number
          query_embedding: string
          query_text: string
          rrf_k?: number
          semantic_weight?: number
        }
        Returns: {
          chunk_id: number
          content: string
          document_id: string
          fts_rank: number
          metadata: Json
          rrf_score: number
          similarity: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
