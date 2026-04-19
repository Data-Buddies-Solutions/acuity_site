export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  readingTime: string;
  date: string;
  tags: string[];
  sections: {
    heading: string;
    paragraphs: string[];
    bullets?: string[];
  }[];
  takeaway: string;
};

export const posts: BlogPost[] = [];

export function getPostBySlug(slug: string) {
  return posts.find((post) => post.slug === slug);
}
