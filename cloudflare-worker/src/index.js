const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

async function externalAI(url, key, model, messages) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 1024
    })
  });

  if (!response.ok) {
    throw new Error(`Provider returned ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) throw new Error("Empty provider response");

  return content;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({ name: "V Chatbot API", status: "online" });
    }

    if (url.pathname !== "/chat" || request.method !== "POST") {
      return json({ error: "Not found" }, 404);
    }

    try {
      const { messages } = await request.json();

      if (!Array.isArray(messages) || messages.length === 0) {
        return json({ error: "Valid messages array required" }, 400);
      }

      const errors = [];

      // 1. Cloudflare Workers AI
      try {
        const result = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          { messages }
        );

        const content = result?.response;

        if (!content) throw new Error("Empty Cloudflare response");

        return json({
          provider: "cloudflare",
          choices: [{ message: { role: "assistant", content } }]
        });
      } catch (error) {
        errors.push(`Cloudflare: ${error.message}`);
      }

      // 2. Groq
      if (env.GROQ_API_KEY) {
        try {
          const content = await externalAI(
            "https://api.groq.com/openai/v1/chat/completions",
            env.GROQ_API_KEY,
            "llama-3.3-70b-versatile",
            messages
          );

          return json({
            provider: "groq",
            choices: [{ message: { role: "assistant", content } }]
          });
        } catch (error) {
          errors.push(`Groq: ${error.message}`);
        }
      }

      // 3. SambaNova
      if (env.SAMBANOVA_API_KEY) {
        try {
          const content = await externalAI(
            "https://api.sambanova.ai/v1/chat/completions",
            env.SAMBANOVA_API_KEY,
            "Meta-Llama-3.3-70B-Instruct",
            messages
          );

          return json({
            provider: "sambanova",
            choices: [{ message: { role: "assistant", content } }]
          });
        } catch (error) {
          errors.push(`SambaNova: ${error.message}`);
        }
      }

      return json({
        error: "All AI providers failed",
        details: errors
      }, 503);

    } catch (error) {
      return json({ error: error.message }, 500);
    }
  }
};
