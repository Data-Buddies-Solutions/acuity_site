import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Acuity Health',
    short_name: 'Acuity Health',
    description: 'The AI phone system for medical teams. Handles scheduling, appointment reminders, and patient education.',
    start_url: '/',
    display: 'standalone',
    background_color: '#faf9f5',
    theme_color: '#cc6633',
    icons: [
      {
        src: '/favicon-old.png',
        sizes: 'any',
        type: 'image/png',
      },
    ],
  }
}
