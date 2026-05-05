import { createAdminClient } from './supabase-server'

export async function generateAndSpeak(
  botId: string,
  text: string,
  interviewId: string
): Promise<void> {
  console.log(`[speak] Starting for bot ${botId}, interview ${interviewId}`)
  console.log(`[speak] Text: "${text.slice(0, 80)}..."`)

  const ttsRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID || 'ljX1ZrXuDIIRVcmiVSyR'}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY!,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
      }),
    }
  )

  if (!ttsRes.ok) {
    const err = await ttsRes.text()
    console.error('[speak] ElevenLabs TTS failed:', ttsRes.status, err)
    return
  }

  const audioBuffer = await ttsRes.arrayBuffer()
  const b64Audio = Buffer.from(audioBuffer).toString('base64')

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

  // Record when the bot started speaking — used only for logging/analytics, not blocking
  const supabase = createAdminClient()
  await supabase.from('interviews').update({ bot_speaking_until: new Date().toISOString() }).eq('id', interviewId)
}
