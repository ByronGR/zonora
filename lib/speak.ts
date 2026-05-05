import { createAdminClient } from './supabase-server'

export async function generateAndSpeak(
  botId: string,
  text: string,
  interviewId: string
): Promise<void> {
  console.log(`[speak] Starting for bot ${botId}, interview ${interviewId}`)
  console.log(`[speak] Text: "${text.slice(0, 80)}..."`)

  // Generate audio with OpenAI TTS
  console.log('[speak] Calling OpenAI TTS...')
  const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      voice: 'nova',
      input: text,
      response_format: 'mp3',
    }),
  })

  if (!ttsRes.ok) {
    const err = await ttsRes.text()
    console.error('[speak] OpenAI TTS failed:', ttsRes.status, err)
    return
  }
  console.log('[speak] OpenAI TTS success')

  const audioBuffer = await ttsRes.arrayBuffer()
  const b64Audio = Buffer.from(audioBuffer).toString('base64')

  // Send audio directly to Recall.ai bot via output_audio
  console.log('[speak] Calling Recall.ai output_audio...')
  const recallRes = await fetch(
    `https://us-west-2.recall.ai/api/v1/bot/${botId}/output_audio/`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.RECALL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ kind: 'mp3', b64_data: b64Audio }),
    }
  )

  if (!recallRes.ok) {
    const err = await recallRes.json().catch(() => recallRes.text())
    console.error('[speak] Recall output_audio failed:', recallRes.status, JSON.stringify(err))
    return
  }

  console.log('[speak] Recall output_audio success — bot is speaking')

  // Mark bot as speaking AFTER audio is successfully queued
  const supabase = createAdminClient()
  const wordCount = text.split(' ').length
  const durationMs = Math.ceil((wordCount / 2.5) * 1000) + 5000
  const speakingUntil = new Date(Date.now() + durationMs).toISOString()
  await supabase.from('interviews').update({ bot_speaking_until: speakingUntil }).eq('id', interviewId)
}
