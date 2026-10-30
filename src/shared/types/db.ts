/**
 * 数据库类型定义 —— **自动生成，不要手改**
 *
 * 来源：Supabase MCP `generate_typescript_types`（project `endwymjjxudepmtwmfpx`）
 * 生成时间：2026-10-30（对应 migration 001~016）
 *
 * 什么时候要重新生成：
 *   - 新增 migration 并 apply 之后（改了表 / 列 / RPC 签名）
 *   - 发现这里缺字段或 RPC 参数对不上
 *
 * 重新生成后**整文件覆盖**，不要手动 merge —— 手改的部分下次就被冲掉了。
 * 需要额外的应用层类型（枚举、视图模型）请放到同目录的其他文件里。
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.18'
  }
  public: {
    Tables: {
      advanced: {
        Row: {
          category_code: string
          content: string | null
          created_at: string
          description: string | null
          id: string
          image: string
          owner_id: string | null
          review_note: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          state: number
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category_code: string
          content?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image: string
          owner_id?: string | null
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: number
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category_code?: string
          content?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image?: string
          owner_id?: string | null
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: number
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      balls: {
        Row: {
          blue_image: string
          color_code: string
          created_at: string
          high_comp: string
          id: string
          impact_image: string
          low_comp: string
          method: string
          owner_id: string | null
          pocket_code: string
          remark: string | null
          review_note: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          route_image: string
          sight: string
          state: number
          strength_code: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          blue_image: string
          color_code: string
          created_at?: string
          high_comp: string
          id?: string
          impact_image: string
          low_comp: string
          method: string
          owner_id?: string | null
          pocket_code: string
          remark?: string | null
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          route_image: string
          sight: string
          state?: number
          strength_code: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          blue_image?: string
          color_code?: string
          created_at?: string
          high_comp?: string
          id?: string
          impact_image?: string
          low_comp?: string
          method?: string
          owner_id?: string | null
          pocket_code?: string
          remark?: string | null
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          route_image?: string
          sight?: string
          state?: number
          strength_code?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      comments: {
        Row: {
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          target_id: string
          target_type: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          target_id: string
          target_type: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          target_id?: string
          target_type?: string
          user_id?: string
        }
        Relationships: []
      }
      dataset_meta: {
        Row: {
          id: number
          updated_at: string
          version: number
        }
        Insert: {
          id?: number
          updated_at?: string
          version?: number
        }
        Update: {
          id?: number
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      display_dict: {
        Row: {
          code: string
          kind: string
          name_zh: string
          sort: number
        }
        Insert: {
          code: string
          kind: string
          name_zh: string
          sort?: number
        }
        Update: {
          code?: string
          kind?: string
          name_zh?: string
          sort?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar: string | null
          created_at: string
          id: string
          nickname: string
          role: string
        }
        Insert: {
          avatar?: string | null
          created_at?: string
          id: string
          nickname: string
          role?: string
        }
        Update: {
          avatar?: string | null
          created_at?: string
          id?: string
          nickname?: string
          role?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_write_records: { Args: never; Returns: boolean }
      current_role_code: { Args: never; Returns: string }
      delete_advanced: {
        Args: { expected_version: number; p_id: string }
        Returns: undefined
      }
      delete_ball: {
        Args: { expected_version: number; p_id: string }
        Returns: undefined
      }
      get_comment_counts: {
        Args: { p_ids: string[]; p_type: string }
        Returns: {
          cnt: number
          target_id: string
        }[]
      }
      get_dataset_snapshot: { Args: never; Returns: Json }
      get_dataset_version: { Args: never; Returns: number }
      has_any_role: { Args: { roles: string[] }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_superadmin: { Args: never; Returns: boolean }
      list_users: {
        Args: never
        Returns: {
          created_at: string
          email: string
          id: string
          nickname: string
          role: string
        }[]
      }
      review_comment: {
        Args: { p_decision: string; p_id: string; p_note?: string }
        Returns: undefined
      }
      review_record: {
        Args: {
          p_decision: string
          p_id: string
          p_note?: string
          p_type: string
        }
        Returns: undefined
      }
      set_user_role: {
        Args: { p_role: string; p_user_id: string }
        Returns: undefined
      }
      upsert_advanced: {
        Args: { expected_version: number; p: Json }
        Returns: Json
      }
      upsert_ball: {
        Args: { expected_version: number; p: Json }
        Returns: Json
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {}
  }
} as const
