"use client";

import Image from "next/image";

const partners = [
  {
    name: "AdvancedMD",
    logo: "/logo-advancedmd.png",
    width: "w-44",
    height: "h-14",
    scale: "",
  },
  {
    name: "Jazzy Eyes Optical",
    logo: "/logo-jazzyeyes.jpg",
    width: "w-44",
    height: "h-14",
    scale: "",
  },
  {
    name: "ElevenLabs",
    logo: "/logo-elevenlabs.png",
    width: "w-44",
    height: "h-14",
    scale: "",
  },
  {
    name: "Abita Eye Group",
    logo: "/logo-abita.png",
    width: "w-44",
    height: "h-14",
    scale: "",
  },
  {
    name: "OnlineDoctorNote",
    logo: "/logo-onlinedoctornote.png",
    width: "w-52",
    height: "h-14",
    scale: "scale-200",
  },
];

const duplicatedPartners = [...partners, ...partners];

export default function Integrations() {
  return (
    <section
      className="py-16 md:py-20 bg-background border-y border-border overflow-hidden"
      id="integrations"
    >
      <div className="mx-auto max-w-6xl px-6 mb-10">
        <div className="text-center">
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-3">
            Who we work with
          </h2>
        </div>
      </div>

      {/* Marquee */}
      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-background to-transparent z-10" />
        <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-background to-transparent z-10" />

        <div className="flex items-center gap-16 animate-scroll">
          {duplicatedPartners.map((partner, index) => (
            <div
              key={`${partner.name}-${index}`}
              className="flex-shrink-0 flex items-center justify-center"
            >
              <div
                className={`${partner.width} ${partner.height} ${partner.scale} relative flex items-center justify-center`}
              >
                <Image
                  src={partner.logo}
                  alt={partner.name}
                  fill
                  className="object-contain transition-all duration-300 grayscale opacity-60 hover:grayscale-0 hover:opacity-100"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        @keyframes scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        .animate-scroll {
          animation: scroll 25s linear infinite;
        }
        .animate-scroll:hover {
          animation-play-state: paused;
        }
      `}</style>
    </section>
  );
}
