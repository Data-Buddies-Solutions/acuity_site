import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Get title from search params, or use default
    const title = searchParams.has('title')
      ? searchParams.get('title')?.slice(0, 100)
      : 'AI Phone System for Medical Teams';

    const subtitle = searchParams.has('subtitle')
      ? searchParams.get('subtitle')?.slice(0, 100)
      : 'Scheduling, reminders, and patient education. Handled.';

    return new ImageResponse(
      (
        <div
          style={{
            background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '80px',
            position: 'relative',
          }}
        >
          {/* Background glow effects */}
          <div
            style={{
              position: 'absolute',
              width: '800px',
              height: '800px',
              background: 'radial-gradient(circle, rgba(231, 86, 21, 0.15) 0%, transparent 70%)',
              top: '-200px',
              right: '-200px',
              borderRadius: '50%',
            }}
          />
          <div
            style={{
              position: 'absolute',
              width: '600px',
              height: '600px',
              background: 'radial-gradient(circle, rgba(231, 86, 21, 0.1) 0%, transparent 70%)',
              bottom: '-150px',
              left: '-150px',
              borderRadius: '50%',
            }}
          />

          {/* Content */}
          <div style={{ display: 'flex', flexDirection: 'column', zIndex: 1 }}>
            {/* Logo section */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '50px' }}>
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  background: '#e75615',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: '20px',
                  fontWeight: 700,
                  color: 'white',
                  fontSize: '28px',
                }}
              >
                AH
              </div>
              <div
                style={{
                  color: 'white',
                  fontSize: '26px',
                  fontWeight: 600,
                  letterSpacing: '-0.5px',
                }}
              >
                Acuity Health
              </div>
            </div>

            {/* Main title */}
            <div
              style={{
                color: 'white',
                fontSize: '72px',
                fontWeight: 700,
                lineHeight: 1.1,
                marginBottom: '30px',
                letterSpacing: '-1.5px',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {title}
            </div>

            {/* Subtitle */}
            <div
              style={{
                color: '#b0b0b0',
                fontSize: '32px',
                fontWeight: 400,
                lineHeight: 1.4,
                maxWidth: '900px',
              }}
            >
              {subtitle}
            </div>
          </div>

          {/* Badge */}
          <div
            style={{
              position: 'absolute',
              bottom: '60px',
              left: '80px',
              background: 'rgba(231, 86, 21, 0.2)',
              border: '2px solid #e75615',
              color: '#e75615',
              padding: '12px 24px',
              borderRadius: '8px',
              fontSize: '18px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}
          >
            AI PHONE SYSTEM
          </div>

          {/* Domain */}
          <div
            style={{
              position: 'absolute',
              bottom: '60px',
              right: '80px',
              color: '#808080',
              fontSize: '20px',
              fontWeight: 500,
            }}
          >
            acuityhealth.io
          </div>
        </div>
      ),
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
