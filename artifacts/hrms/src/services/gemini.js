/**
 * AI helpers for the UI. Calls go through the HR API (server-side Gemini key,
 * workspace plan checks); no AI key is ever shipped to the browser.
 */
import api from './api';

/**
 * @param {Array} messages - [{role:'user'|'assistant', content:'...'}]
 */
export const chatWithGemini = async (messages) => {
  try {
    const { data } = await api.post('/ai/chat', { messages });
    return data?.data?.message || "I didn't get a response. Please try again.";
  } catch (err) {
    const status = err.response?.status;
    if (status === 403) return err.response?.data?.message || 'AI features are not included in your plan.';
    if (status === 429) return "I'm handling too many requests right now. Please try again in a moment.";
    return "I'm having trouble connecting. Please try again shortly.";
  }
};

/** One-sentence insight; returns null when AI is unavailable. */
export const getQuickInsight = async (topic, data) => {
  try {
    const { data: res } = await api.post('/ai/chat', {
      messages: [
        {
          role: 'user',
          content: `As an HR AI, give a 1-sentence insight about: ${topic}. Data: ${JSON.stringify(data)}. Be concise.`,
        },
      ],
    });
    return res?.data?.message || null;
  } catch {
    return null;
  }
};

export default { chatWithGemini, getQuickInsight };
