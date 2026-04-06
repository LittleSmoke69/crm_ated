// Re-export do serviço Supabase para compatibilidade com código existente
export { supabase } from '@/lib/services/supabase-service';

// Mantém a interface Database para tipos TypeScript

export interface Database {
  public: {
    Tables: {
      webhook_configs: {
        Row: {
          id: string;
          webhook_url: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          webhook_url: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          webhook_url?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };

      whatsapp_instances: {
        Row: {
          id: string;
          instance_name: string;
          status: string;
          qr_code: string | null;
        number: string | null;
          created_at: string;
          connected_at: string | null;
          updated_at: string;
          hash: string | null;
          user_id: string | null; // novo
        };
        Insert: {
          id?: string;
          instance_name: string;
          status?: string;
          qr_code?: string | null;
          number?: string | null;
          created_at?: string;
          connected_at?: string | null;
          updated_at?: string;
          hash?: string | null;
          user_id?: string | null; // novo
        };
        Update: {
          id?: string;
          instance_name?: string;
          status?: string;
          qr_code?: string | null;
          number?: string | null;
          created_at?: string;
          connected_at?: string | null;
          updated_at?: string;
          hash?: string | null;
          user_id?: string | null; // novo
        };
      };

      searches: {
        Row: {
          id: string;
          city: string;
          state: string;
          niche: string;
          neighborhoods: string[] | null;
          status: string;
          total_results: number | null;
          created_at: string;
          place_id: string | null;
          rating: string | null;
          telefone: string | null;
          website: string | null;
          endereco: string | null;
          name: string | null;
          user_id: string | null; // novo
        };
        Insert: {
          id?: string;
          city: string;
          state: string;
          niche: string;
          neighborhoods?: string[] | null;
          status?: string;
          total_results?: number | null;
          created_at?: string;
          place_id?: string | null;
          rating?: string | null;
          telefone?: string | null;
          website?: string | null;
          endereco?: string | null;
          name?: string | null;
          user_id?: string | null; // novo
        };
        Update: {
          id?: string;
          city?: string;
          state?: string;
          niche?: string;
          neighborhoods?: string[] | null;
          status?: string;
          total_results?: number | null;
          created_at?: string;
          place_id?: string | null;
          rating?: string | null;
          telefone?: string | null;
          website?: string | null;
          endereco?: string | null;
          name?: string | null;
          user_id?: string | null; // novo
        };
      };

      whatsapp_groups: {
        Row: {
          id: string;
          instance_name: string;
          group_id: string;
          group_subject: string | null;
          picture_url: string | null;
          size: number | null;
          created_at: string;
          updated_at: string;
          user_id: string | null; // novo
        };
        Insert: {
          id?: string;
          instance_name: string;
          group_id: string;
          group_subject?: string | null;
          picture_url?: string | null;
          size?: number | null;
          created_at?: string;
          updated_at?: string;
          user_id?: string | null; // novo
        };
        Update: {
          id?: string;
          instance_name?: string;
          group_id?: string;
          group_subject?: string | null;
          picture_url?: string | null;
          size?: number | null;
          created_at?: string;
          updated_at?: string;
          user_id?: string | null; // novo
        };
      };

      profiles: {
        Row: {
          id: string;                 // uuid (PK)
          full_name: string | null;
          email: string;
          password_hash: string;      // armazenamos o hash
          status: string | null;      // 'admin' para administradores
          enroller: string | null;    // ID do superior na hierarquia
          banca_name: string | null;
          banca_url: string | null;
          telefone: string | null;
          created_at: string;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          full_name?: string | null;
          email: string;
          password_hash: string;
          status?: string | null;
          enroller?: string | null;
          banca_name?: string | null;
          banca_url?: string | null;
          telefone?: string | null;
          created_at?: string;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          email?: string;
          password_hash?: string;
          status?: string | null;
          enroller?: string | null;
          banca_name?: string | null;
          banca_url?: string | null;
          telefone?: string | null;
          created_at?: string;
          updated_at?: string | null;
        };
      };

      campaigns: {
        Row: {
          id: string;
          user_id: string;
          group_id: string;
          group_subject: string | null;
          status: string; // 'pending' | 'running' | 'completed' | 'failed' | 'paused'
          total_contacts: number;
          processed_contacts: number;
          failed_contacts: number;
          strategy: Record<string, any>; // JSON com delayConfig, distributionMode, etc
          instances: string[]; // Array de nomes de instâncias
          created_at: string;
          updated_at: string;
          started_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          group_id: string;
          group_subject?: string | null;
          status?: string;
          total_contacts: number;
          processed_contacts?: number;
          failed_contacts?: number;
          strategy: Record<string, any>;
          instances: string[];
          created_at?: string;
          updated_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          group_id?: string;
          group_subject?: string | null;
          status?: string;
          total_contacts?: number;
          processed_contacts?: number;
          failed_contacts?: number;
          strategy?: Record<string, any>;
          instances?: string[];
          created_at?: string;
          updated_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
        };
      };

      user_settings: {
        Row: {
          id: string;
          user_id: string;
          max_leads_per_day: number;
          max_instances: number;
          is_admin: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          max_leads_per_day?: number;
          max_instances?: number;
          is_admin?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          max_leads_per_day?: number;
          max_instances?: number;
          is_admin?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };

      evolution_apis: {
        Row: {
          id: string;
          name: string;
          base_url: string;
          api_key_global: string;
          is_active: boolean;
          is_blocked_for_instances: boolean;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          base_url: string;
          api_key_global: string;
          is_active?: boolean;
          is_blocked_for_instances?: boolean;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          base_url?: string;
          api_key_global?: string;
          is_active?: boolean;
          is_blocked_for_instances?: boolean;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };

      user_evolution_apis: {
        Row: {
          id: string;
          user_id: string;
          evolution_api_id: string;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          evolution_api_id: string;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          evolution_api_id?: string;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };

      evolution_instances: {
        Row: {
          id: string;
          evolution_api_id: string;
          instance_name: string;
          phone_number: string | null;
          is_active: boolean;
          status: string; // 'ok', 'rate_limited', 'blocked', 'error', 'disconnected'
          daily_limit: number | null;
          sent_today: number;
          error_today: number;
          rate_limit_count_today: number;
          last_used_at: string | null;
          cooldown_until: string | null;
          user_id: string | null; // ID do usuário que criou a instância
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          evolution_api_id: string;
          instance_name: string;
          phone_number?: string | null;
          is_active?: boolean;
          status?: string;
          daily_limit?: number | null;
          sent_today?: number;
          error_today?: number;
          rate_limit_count_today?: number;
          last_used_at?: string | null;
          cooldown_until?: string | null;
          user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          evolution_api_id?: string;
          instance_name?: string;
          phone_number?: string | null;
          is_active?: boolean;
          status?: string;
          daily_limit?: number | null;
          sent_today?: number;
          error_today?: number;
          rate_limit_count_today?: number;
          last_used_at?: string | null;
          cooldown_until?: string | null;
          user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };

      evolution_instance_logs: {
        Row: {
          id: string;
          evolution_instance_id: string;
          type: string; // 'success', 'error', 'rate_limit', 'blocked'
          http_status: number | null;
          error_code: string | null;
          error_message: string | null;
          group_id: string | null;
          lead_phone: string | null;
          raw_response_snippet: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          evolution_instance_id: string;
          type: string;
          http_status?: number | null;
          error_code?: string | null;
          error_message?: string | null;
          group_id?: string | null;
          lead_phone?: string | null;
          raw_response_snippet?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          evolution_instance_id?: string;
          type?: string;
          http_status?: number | null;
          error_code?: string | null;
          error_message?: string | null;
          group_id?: string | null;
          lead_phone?: string | null;
          raw_response_snippet?: string | null;
          created_at?: string;
        };
      };

      messages: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          content: string;
          preview: string | null;
          category: string;
          is_favorite: boolean;
          has_attachment: boolean;
          mention_all: boolean;
          attachment_with_caption: boolean;
          message_type: string;
          attachment_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          content: string;
          preview?: string | null;
          category?: string;
          is_favorite?: boolean;
          has_attachment?: boolean;
          mention_all?: boolean;
          attachment_with_caption?: boolean;
          message_type?: string;
          attachment_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          content?: string;
          preview?: string | null;
          category?: string;
          is_favorite?: boolean;
          has_attachment?: boolean;
          mention_all?: boolean;
          attachment_with_caption?: boolean;
          message_type?: string;
          attachment_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };

      academy_modules: {
        Row: {
          id: string;
          title: string;
          slug: string;
          description: string | null;
          order_index: number;
          is_published: boolean;
          thumbnail_url: string | null;
          tags: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          slug: string;
          description?: string | null;
          order_index?: number;
          is_published?: boolean;
          thumbnail_url?: string | null;
          tags?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          slug?: string;
          description?: string | null;
          order_index?: number;
          is_published?: boolean;
          thumbnail_url?: string | null;
          tags?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
      };

      academy_lessons: {
        Row: {
          id: string;
          module_id: string;
          title: string;
          slug: string;
          description: string | null;
          order_index: number;
          is_published: boolean;
          content_type: 'vturb' | 'iframe' | 'text';
          estimated_minutes: number | null;
          vturb_player_id: string | null;
          vturb_project_id: string | null;
          vturb_aspect_ratio: number | null;
          vturb_use_sdk: boolean;
          iframe_html: string | null;
          cta_label: string | null;
          cta_type: 'internal' | 'external' | null;
          cta_url: string | null;
          cta_target: '_self' | '_blank';
          allowed_role_codes: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          module_id: string;
          title: string;
          slug: string;
          description?: string | null;
          order_index?: number;
          is_published?: boolean;
          content_type: 'vturb' | 'iframe' | 'text';
          estimated_minutes?: number | null;
          vturb_player_id?: string | null;
          vturb_project_id?: string | null;
          vturb_aspect_ratio?: number | null;
          vturb_use_sdk?: boolean;
          iframe_html?: string | null;
          cta_label?: string | null;
          cta_type?: 'internal' | 'external' | null;
          cta_url?: string | null;
          cta_target?: '_self' | '_blank';
          allowed_role_codes?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          module_id?: string;
          title?: string;
          slug?: string;
          description?: string | null;
          order_index?: number;
          is_published?: boolean;
          content_type?: 'vturb' | 'iframe' | 'text';
          estimated_minutes?: number | null;
          vturb_player_id?: string | null;
          vturb_project_id?: string | null;
          vturb_aspect_ratio?: number | null;
          vturb_use_sdk?: boolean;
          iframe_html?: string | null;
          cta_label?: string | null;
          cta_type?: 'internal' | 'external' | null;
          cta_url?: string | null;
          cta_target?: '_self' | '_blank';
          allowed_role_codes?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
      };

      academy_assets: {
        Row: {
          id: string;
          type: 'image' | 'table' | 'pdf' | 'doc' | 'docx' | 'other';
          title: string;
          description: string | null;
          file_path: string;
          public_url: string | null;
          category: string | null;
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          type: 'image' | 'table' | 'pdf' | 'doc' | 'docx' | 'other';
          title: string;
          description?: string | null;
          file_path: string;
          public_url?: string | null;
          category?: string | null;
          is_published?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          type?: 'image' | 'table' | 'pdf' | 'doc' | 'docx' | 'other';
          title?: string;
          description?: string | null;
          file_path?: string;
          public_url?: string | null;
          category?: string | null;
          is_published?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };

      academy_lesson_attachments: {
        Row: {
          id: string;
          lesson_id: string;
          asset_id: string;
          label: string | null;
          order_index: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          lesson_id: string;
          asset_id: string;
          label?: string | null;
          order_index?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          lesson_id?: string;
          asset_id?: string;
          label?: string | null;
          order_index?: number;
          created_at?: string;
          updated_at?: string;
        };
      };

      academy_user_progress: {
        Row: {
          id: string;
          user_id: string;
          lesson_id: string;
          status: 'not_started' | 'in_progress' | 'completed';
          completed_at: string | null;
          last_seen_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          lesson_id: string;
          status?: 'not_started' | 'in_progress' | 'completed';
          completed_at?: string | null;
          last_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          lesson_id?: string;
          status?: 'not_started' | 'in_progress' | 'completed';
          completed_at?: string | null;
          last_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };

      academy_vturb_snapshots: {
        Row: {
          id: string;
          lesson_id: string | null;
          player_id: string;
          date_start: string;
          date_end: string;
          payload: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          lesson_id?: string | null;
          player_id: string;
          date_start: string;
          date_end: string;
          payload: Record<string, unknown>;
          created_at?: string;
        };
        Update: {
          id?: string;
          lesson_id?: string | null;
          player_id?: string;
          date_start?: string;
          date_end?: string;
          payload?: Record<string, unknown>;
          created_at?: string;
        };
      };
    };
  };
}

/** Helpers de tipos úteis */
export type TableRow<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TableInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TableUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];