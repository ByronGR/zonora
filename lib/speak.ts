import { createAdminClient } from './supabase-server'

// Rachel — free ElevenLabs voice available on all plans
const VOICE_ID = '21m00Tcm4TlvDq8ikWAM'

export async function generateAndSpeak(
  botId: string,
  text: string,
  interviewId: string
): Promise<void> {
  console.log(`[speak] Starting for bot ${botId}, interview ${interviewId}`)
  console.log(`[speak] Text: "${text.slice(0, 80)}..."`)

  const supabase = createAdminClient()

  // Generate audio with ElevenLabs
  console.log('[speak] Calling ElevenLabs TTS...')
  const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })

  if (!ttsRes.ok) {
    const err = await ttsRes.text()
    console.error('[speak] ElevenLabs TTS failed:', ttsRes.status, err)
    return
  }
  console.log('[speak] ElevenLabs TTS success, uploading audio...')

  const audioBuffer = await ttsRes.arrayBuffer()
  const fileName = `${interviewId}/${Date.now()}.mp3`

  const { error: uploadError } = await supabase.storage
    .from('audio')
    .upload(fileName, Buffer.from(audioBuffer), {
      contentType: 'audio/mpeg',
      upsert: true,
    })

  if (uploadError) {
    console.error('[speak] Storage upload failed:', uploadError)
    return
  }

  const { data: { publicUrl } } = supabase.storage.from('audio').getPublicUrl(fileName)
  console.log('[speak] Audio uploaded, public URL:', publicUrl)

  // Send audio to Recall.ai bot to play in the meeting
  console.log('[speak] Calling Recall.ai output_media...')
  const recallRes = await fetch(
    `https://us-west-2.recall.ai/api/v1/bot/${botId}/output_media/`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.RECALL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ kind: 'audio', audio_url: publicUrl }),
    }
  )

  if (!recallRes.ok) {
    const err = await recallRes.json()
    console.error('[speak] Recall output_media failed:', recallRes.status, JSON.stringify(err))
    return
  }

  console.log('[speak] Recall output_media success — bot is speaking')

  // Mark bot as speaking AFTER audio is successfully queued, so failed attempts don't block transcripts
  const wordCount = text.split(' ').length
  const durationMs = Math.ceil((wordCount / 2.5) * 1000) + 5000
  const speakingUntil = new Date(Date.now() + durationMs).toISOString()
  await supabase.from('interviews').update({ bot_speaking_until: speakingUntil }).eq('id', interviewId)
}
