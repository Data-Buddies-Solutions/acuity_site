import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET() {
  try {
    const DOT = "#0f1115";

    return new ImageResponse(
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "40px",
          }}
        >
          <svg height="180" viewBox="0 0 100 100" width="180">
            <circle cx="50" cy="15" fill={DOT} r="11" />
            <circle cx="20" cy="35" fill={DOT} r="11" />
            <circle cx="80" cy="35" fill={DOT} r="11" />
            <circle cx="50" cy="50" fill={DOT} r="11" />
            <circle cx="20" cy="65" fill={DOT} r="11" />
            <circle cx="80" cy="65" fill={DOT} r="11" />
            <circle cx="50" cy="85" fill={DOT} r="11" />
          </svg>
          <div
            style={{
              fontSize: "108px",
              fontWeight: 600,
              color: DOT,
              letterSpacing: "-0.035em",
            }}
          >
            Acuity Health
          </div>
        </div>
      </div>,
      {
        width: 1200,
        height: 630,
      },
    );
  } catch (e: any) {
    console.log(`${e.message}`);
    return new Response(`Failed to generate the image`, {
      status: 500,
    });
  }
}
