// Shared Instagram types — single source of truth

export interface ImageCandidate {
  width: number;
  height: number;
  url: string;
}

export interface CarouselItem {
  id: string;
  pk: number;
  media_type: number;
  image_versions2: {
    candidates: ImageCandidate[];
  };
}

export interface InstagramUser {
  pk: number;
  username: string;
  full_name: string;
  is_private: boolean;
  profile_pic_url: string;
  is_verified: boolean;
}

export interface InstagramPost {
  id: string;
  pk: number;
  code?: string; // URL shortcode (instagram.com/reel/{code})
  media_type: number; // 1 = image, 2 = video, 8 = carousel
  taken_at: number; // Unix timestamp
  image_versions2: {
    candidates?: ImageCandidate[];
  };
  video_versions?: { width: number; height: number; url: string }[];
  carousel_media?: CarouselItem[];
  carousel_media_count?: number;
  original_width?: number;
  original_height?: number;
  has_audio?: boolean;
  video_duration?: number;
  caption: { text: string } | null;
  user: InstagramUser;
  product_type?: string;
  comment_count: number;
  like_count: number;
}

export interface InstagramUserLookup {
  UserID: number;
  UserName: string;
}

export interface InstagramProfile {
  pk: number;
  username: string;
  full_name: string;
  is_private: boolean;
  profile_pic_url: string;
  is_verified: boolean;
  media_count: number;
  follower_count: number;
  following_count: number;
  biography: string;
  external_url: string | null;
  category: string | null;
  hd_profile_pic_url_info?: { url: string; width: number; height: number };
}

export interface InstagramFeed {
  items: InstagramPost[];
  num_results: number;
  more_available: boolean;
  next_max_id?: string;
  status: string;
}

export interface InstagramComment {
  pk: string;
  text: string;
  created_at: number;
  comment_like_count: number;
  user: {
    pk: number;
    username: string;
    full_name: string;
    profile_pic_url: string;
    is_verified: boolean;
  };
}

export interface InstagramCommentsResponse {
  comments: InstagramComment[];
  comment_count: number;
  has_more_comments: boolean;
  next_min_id?: string;
}

export interface HashtagFeedResponse {
  sections: {
    layout_content: {
      medias: { media: InstagramPost }[];
    };
  }[];
  next_max_id?: string;
  next_page?: number;
  rank_token?: string;
  more_available: boolean;
  status: string;
}
