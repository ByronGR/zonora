import { NextRequest, NextResponse } from 'next/server'
import { generateAndSpeak } from '@/lib/speak'

// Temporary debug endpoint — manually trigger speak pipeline
// POST /api/test-speak  body: { bot_id, interview_id, text? }
export async function POST(req: NextRequest) {
  const { bot_id, interview_id, text } = await req.json()

  if (!bot_id || !interview_id) {
    return NextResponse.json({ error: 'bot_id and interview_id required' }, { status: 400 })
  }

  const message = text || 'Hello, this is a test of the Zonora voice system. If you can hear this, everything is working correctly.'

  console.log('[test-speak] Triggering speak for bot:', bot_id)
  await generateAndSpeak(bot_id, message, interview_id)
  console.log('[test-speak] Done')

  return NextResponse.json({ success: true, message })
}
