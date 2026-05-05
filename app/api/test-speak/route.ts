import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

const VOICE_ID = '21m00Tcm4TlvDq8ikWAM'

// Diagnostics endpoint — tests each step of the speak pipeline individually
// POST /api/test-speak  body: { bot_id, interview_id, text? }
export async function POST(req: NextRequest) {
  const { bot_id, interview_id, text } = await req.json()

  if (!bot_id || !interview_id) {
    return NextResponse.json({ error: 'bot_id and interview_id required' }, { status: 400 })
  }

  const message = text || 'Hello, this is a test of the Zonora voice system.'
  const results: Record<string, unknown> = {}

  // Step 1: ElevenLabs TTS
  const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text: message,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })

  if (!ttsRes.ok) {
    const err = await ttsRes.text()
    results.tts = { ok: false, status: ttsRes.status, error: err }
    return NextResponse.json({ step_failed: 'elevenlabs_tts', results })
  }

  results.tts = { ok: true, status: ttsRes.status, content_type: ttsRes.headers.get('content-type') }

  // Step 2: Supabase Storage upload
  const supabase = createAdminClient()
  const audioBuffer = await ttsRes.arrayBuffer()
  const fileName = `${interview_id}/${Date.now()}.mp3`

  const { error: uploadError } = await supabase.storage
    .from('audio')
    .upload(fileName, Buffer.from(audioBuffer), { contentType: 'audio/mpeg', upsert: true })

  if (uploadError) {
    results.upload = { ok: false, error: uploadError.message }
    return NextResponse.json({ step_failed: 'supabase_upload', results })
  }

  const { data: { publicUrl } } = supabase.storage.from('audio').getPublicUrl(fileName)
  results.upload = { ok: true, public_url: publicUrl }

  // Step 3: Recall.ai output_media
  const recallBody = { kind: 'audio', audio_url: publicUrl }
  const recallRes = await fetch(
    `https://us-west-2.recall.ai/api/v1/bot/${bot_id}/output_media/`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.RECALL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(recallBody),
    }
  )

  const recallText = await recallRes.text()
  let recallJson: unknown
  try { recallJson = JSON.parse(recallText) } catch { recallJson = recallText }

  results.recall_output_media = {
    ok: recallRes.ok,
    status: recallRes.status,
    request_body: recallBody,
    response: recallJson,
  }

  if (!recallRes.ok) {
    return NextResponse.json({ step_failed: 'recall_output_media', results })
  }

  return NextResponse.json({ success: true, results })
}
