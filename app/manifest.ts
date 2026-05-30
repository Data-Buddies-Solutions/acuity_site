import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Acuity Health",
    short_name: "Acuity",
    description:
      "AI receptionist for ophthalmology. Answer every call, book directly into your EMR.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f5",
    theme_color: "#0b1f23",
    icons: [
      {
        src: "/favicon.png",
        sizes: "any",
        type: "image/png",
      },
    ],
  };
}
