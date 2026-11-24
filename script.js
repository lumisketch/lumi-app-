document.addEventListener("DOMContentLoaded", () => {
  const $ = id => document.getElementById(id);

  const KEYS = {
    users: "lumi_demo_users",
    session: "lumi_demo_session",
    settings: "lumi_settings",
    conversations: "lumi_conversations",
    memories: "lumi_memories"
  };

  // O backend deverá receber as mensagens e consultar a Groq.
  const API_URL = "https://lumi-backend-3vid.onrender.com/api/chat";
  const API_CREDITS_URL = "https://lumi-backend-3vid.onrender.com/api/credits";
const SUPABASE_URL = "https://iroyxvsbzkqwzebptvos.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_O8TH7RAmEi93qF7-KIG2_Q_nFYjdBO8";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
  // CARREGAR CRÉDITOS DA LUMI
async function loadCredits() {
  try {
    const { data, error } = await supabaseClient.auth.getSession();

    if (error || !data.session) return;

    const response = await fetch(API_CREDITS_URL, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${data.session.access_token}`
      }
    });

    if (!response.ok) {
      throw new Error("Não foi possível carregar os créditos.");
    }

    const result = await response.json();
    const credits = result.credits;

    if (!credits) return;

    $("creditsTotal").textContent =
      Number(credits.total ?? 0);

    $("dailyCredits").textContent =
      Number(credits.daily_credits ?? 0);

    $("subscriptionCredits").textContent =
      Number(credits.subscription_credits ?? 0);

    $("purchasedCredits").textContent =
      Number(credits.purchased_credits ?? 0);

  } catch (error) {
    console.error("Erro ao carregar créditos:", error);
  }
}
 
  const defaults = {
    theme: "dark",
    fontSize: 14,
    personality: "Amigável e carinhosa",
    customPersonality: "",
    filter: 50,
    memory: true
  };

  let settings = {...defaults, ...read(KEYS.settings, {})};
  let conversations = [];
  let currentChatId = null;
  let messages = [];
  let editingChatId = null;
  let currentUser = read(KEYS.session, null);
  let authMode = "login";
  let busy = false;
  let showingFavorites = false;

  function read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function userKey(base) {
    return currentUser ? base + "_" + currentUser.email : base + "_guest";
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2800);
  }

  function applySettings() {
    document.body.classList.toggle("light", settings.theme === "light");
    document.documentElement.style.setProperty(
      "--chat-font", settings.fontSize + "px"
    );

    $("fontSize").value = settings.fontSize;
    $("fontValue").textContent = settings.fontSize + "px";

    $("filterLevel").value = settings.filter;
    $("filterValue").textContent = settings.filter + "%";

    $("personality").value = settings.personality;
    $("customPersonality").value = settings.customPersonality || "";
    $("memoryEnabled").checked = settings.memory;

    document.querySelectorAll(".theme-choice").forEach(button => {
      button.classList.toggle(
        "selected",
        button.dataset.theme === settings.theme
      );
    });
  }

  function loadAccount() {
    if (currentUser) {
      $("profileName").textContent = currentUser.name;
      $("profileEmail").textContent = currentUser.email;
      $("avatar").textContent = currentUser.name.charAt(0).toUpperCase();
      $("accountName").value = currentUser.name;
      $("accountEmail").value = currentUser.email;
      $("accountBtn").hidden = false;
    } else {
      $("profileName").textContent = "Visitante";
      $("profileEmail").textContent = "Modo visitante";
      $("avatar").textContent = "U";
      $("accountName").value = "";
      $("accountEmail").value = "";
      $("accountBtn").hidden = false;
    }
  }

  function loadConversations() {
    conversations = read(userKey(KEYS.conversations), []);
    renderHistory();
  }

  function saveConversations() {
    write(userKey(KEYS.conversations), conversations);
    renderHistory();
  }

async function syncChatToSupabase(chat) {
  if (!currentUser || !currentUser.id) return;

  const userId = currentUser.id;

  const { error: chatError } = await supabaseClient
    .from("conversations")
    .upsert({
      id: chat.id,
      user_id: userId,
      title: chat.title,
      updated_at: new Date(chat.updatedAt).toISOString()
    });

  if (chatError) throw chatError;

  const { error: deleteError } = await supabaseClient
    .from("messages")
    .delete()
    .eq("conversation_id", chat.id)
    .eq("user_id", userId);

  if (deleteError) throw deleteError;

  if (chat.messages.length > 0) {
    const rows = chat.messages.map((message, index) => ({
      conversation_id: chat.id,
      user_id: userId,
      role: message.role,
      content: message.content,
      created_at: new Date(Date.now() + index).toISOString()
    }));

    const { error: insertError } = await supabaseClient
      .from("messages")
      .insert(rows);

    if (insertError) throw insertError;
  }
}

  function createChat() {
    if (messages.length) saveCurrentChat();

    currentChatId = crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now());

    messages = [];
    showingFavorites = false;

    $("favoritesNav").classList.remove("active");
    $("chatNav").classList.add("active");

    renderMessages();
    renderHistory();

    if (window.innerWidth <= 760) {
      $("sidebar").classList.remove("open");
    }

    $("messageInput").focus();
  }

  function saveCurrentChat() {
    if (!messages.length || !currentChatId) return;

    const existing = conversations.find(
      chat => chat.id === currentChatId
    );

    const firstUserMessage = messages.find(
      message => message.role === "user"
    );

    const chat = {
      id: currentChatId,
      title: firstUserMessage
        ? firstUserMessage.content.slice(0, 38)
        : "Nova conversa",
      messages: messages,
      favorite: existing ? existing.favorite : false,
      updatedAt: Date.now()
    };

    const index = conversations.findIndex(
      item => item.id === currentChatId
    );

    if (index >= 0) {
      conversations[index] = chat;
    } else {
      conversations.unshift(chat);
    }

    conversations.sort((a, b) => b.updatedAt - a.updatedAt);
saveConversations();

if (currentUser) {
  syncChatToSupabase(chat).catch(error => {
    console.error("Erro ao salvar no Supabase:", error);
    showToast("Não consegui salvar a conversa na nuvem.");
  });
}

}

  function renderHistory() {
    const list = $("historyList");
    list.replaceChildren();

    let items = conversations;

    if (showingFavorites) {
      items = conversations.filter(chat => chat.favorite);
    }

    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "empty-history";
      empty.textContent = showingFavorites
        ? "Você ainda não tem favoritos."
        : "Suas conversas aparecerão aqui.";
      list.appendChild(empty);
      return;
    }

    items.forEach(chat => {
      const row = document.createElement("div");
      row.className = "history-item";

      if (chat.id === currentChatId) row.classList.add("active");

      const title = document.createElement("span");
      title.className = "history-title";
      title.textContent = chat.title;
const rename = document.createElement("button");
rename.className = "icon-btn";
rename.textContent = "✎";
rename.title = "Renomear conversa";

rename.addEventListener("click", async event => {
  event.stopPropagation();

  const newTitle = prompt("Digite o novo nome da conversa:", chat.title);

  if (!newTitle || !newTitle.trim()) return;

  const oldTitle = chat.title;
  chat.title = newTitle.trim().slice(0, 60);

  if (currentUser && currentUser.id) {
    const { error } = await supabaseClient
      .from("conversations")
      .update({ title: chat.title })
      .eq("id", chat.id)
      .eq("user_id", currentUser.id);

    if (error) {
      chat.title = oldTitle;
      showToast("Não foi possível renomear a conversa.");
      console.error(error);
      return;
    }
  }

  saveConversations();
  showToast("Conversa renomeada! ✦");
});

      const favorite = document.createElement("button");
      favorite.className = "icon-btn";
      favorite.textContent = chat.favorite ? "♥" : "♡";
      favorite.title = "Adicionar ou remover favorito";
      favorite.setAttribute("aria-label", favorite.title);

      
favorite.addEventListener("click", async event => {
  event.stopPropagation();

  const previousFavorite = chat.favorite;
  chat.favorite = !chat.favorite;

  try {
    if (currentUser && currentUser.id) {
      const { error } = await supabaseClient
        .from("conversations")
        .update({ favorite: chat.favorite })
        .eq("id", chat.id)
        .eq("user_id", currentUser.id);

      if (error) throw error;
    }

    saveConversations();
    showToast(
      chat.favorite
        ? "Adicionada aos favoritos! ♥"
        : "Removida dos favoritos."
    );

  } catch (error) {
    chat.favorite = previousFavorite;
    renderHistory();
    console.error("Erro ao salvar favorito:", error);
    showToast("Não foi possível salvar o favorito.");
  }
});


      const remove = document.createElement("button");
      remove.className = "icon-btn delete-chat";
      remove.textContent = "×";
      remove.title = "Excluir conversa";

      
remove.addEventListener("click", async event => {
  event.stopPropagation();

  if (!confirm("Excluir esta conversa permanentemente?")) return;

  try {
    if (currentUser && currentUser.id) {
      const { error: messagesError } = await supabaseClient
        .from("messages")
        .delete()
        .eq("conversation_id", chat.id)
        .eq("user_id", currentUser.id);

      if (messagesError) throw messagesError;

      const { error: chatError } = await supabaseClient
        .from("conversations")
        .delete()
        .eq("id", chat.id)
        .eq("user_id", currentUser.id);

      if (chatError) throw chatError;
    }

    conversations = conversations.filter(
      item => item.id !== chat.id
    );

    if (currentChatId === chat.id) {
      currentChatId = null;
      messages = [];
      renderMessages();
    }

    saveConversations();
    showToast("Conversa excluída com sucesso!");

  } catch (error) {
    console.error("Erro ao excluir conversa:", error);
    showToast("Não foi possível excluir a conversa.");
  }
});


      row.append(title, rename, favorite, remove);

      row.addEventListener("click", () => {
        openChat(chat.id);
      });

      list.appendChild(row);
    });
  }

  function openChat(id) {
    const chat = conversations.find(item => item.id === id);
    if (!chat) return;

    currentChatId = chat.id;
    messages = [...chat.messages];
    showingFavorites = false;

    $("chatNav").classList.add("active");
    $("favoritesNav").classList.remove("active");

    renderMessages();
    renderHistory();

    if (window.innerWidth <= 760) {
      $("sidebar").classList.remove("open");
    }
  }

  
  function renderMessages() {
    const container = $("messages");
    container.replaceChildren();

    $("welcome").hidden = messages.length > 0;

    messages.forEach((message, index) => {
      const item = document.createElement("div");
      item.className = "message " +
        (message.role === "user" ? "user" : "ai");

      const label = document.createElement("div");
      label.className = "message-label";
      label.textContent = message.role === "user"
        ? "Você"
        : "✦ LUMI";

      const bubble = document.createElement("div");
      bubble.className = "message-bubble";

      const formattedMessage = marked.parse(message.content);
      bubble.innerHTML = DOMPurify.sanitize(formattedMessage);

      const actions = document.createElement("div");
      actions.className = "message-actions";
      actions.style.display = "flex";
      actions.style.alignItems = "center";
      actions.style.gap = "5px";
      actions.style.marginTop = "5px";

      function addAction(symbol, description, callback) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = symbol;
        button.title = description;
        button.setAttribute("aria-label", description);
        button.style.background = "transparent";
        button.style.border = "none";
        button.style.color = "inherit";
        button.style.opacity = "0.75";
        button.style.cursor = "pointer";
        button.style.fontSize = "14px";
        button.style.padding = "3px 6px";

        button.addEventListener("click", callback);
        actions.appendChild(button);
      }

      if (message.role === "user") {
        addAction("⧉", "Copiar mensagem", () => {
          copyMessage(message.content);
        });

        addAction("✎", "Editar mensagem", () => {
          editMessage(index);
        });
      } else {
        addAction("⧉", "Copiar resposta", () => {
          copyMessage(message.content);
        });

        addAction("↻", "Gerar outra resposta", () => {
          regenerateResponse(index);
        });

        if (message.versions && message.versions.length > 1) {
          addAction("←", "Voltar à resposta anterior", () => {
            showPreviousResponse(index);
          });
        }
      }

      item.append(label, bubble, actions);
      container.appendChild(item);
    });

    $("chatArea").scrollTop = $("chatArea").scrollHeight;
  }

  async function copyMessage(content) {
    try {
      await navigator.clipboard.writeText(content);
      showToast("Mensagem copiada! ✦");
    } catch (error) {
      console.error("Erro ao copiar:", error);
      showToast("Não foi possível copiar a mensagem.");
    }
  }

  function showPreviousResponse(index) {
    const message = messages[index];

    if (!message || !message.versions ||
        message.versions.length < 2) return;

    const currentIndex = message.versionIndex ??
      message.versions.length - 1;

    if (currentIndex <= 0) return;

    message.versionIndex = currentIndex - 1;
    message.content = message.versions[message.versionIndex];

    saveCurrentChat();
    renderMessages();
  }

  async function regenerateResponse(index) {
    if (busy) return;

    const message = messages[index];

    if (!message || message.role !== "assistant") return;

    busy = true;
    $("sendBtn").disabled = true;
    $("typing").hidden = false;

    try {
      const answer = await callAI(messages.slice(0, index));

      if (!message.versions) {
        message.versions = [message.content];
      }

      message.versions.push(answer);
      message.versionIndex = message.versions.length - 1;
      message.content = answer;

      saveCurrentChat();
      renderMessages();

    } catch (error) {
      console.error("Erro ao gerar outra resposta:", error);
      showToast("Não consegui gerar outra resposta.");
    } finally {
      $("typing").hidden = true;
      $("sendBtn").disabled = false;
      busy = false;
    }
  }

  async function editMessage(index) {
  const message = messages[index];

  if (!message || message.role !== "user" || busy) return;

  const editedText = message.content;
    editingChatId = currentChatId;

  messages = messages.slice(0, index);
    

  saveCurrentChat();
  renderMessages();

  const input = $("messageInput");
  input.value = editedText;
  input.style.height = "auto";
  input.style.height =
    Math.min(input.scrollHeight, 140) + "px";
  input.focus();

  showToast("Mensagem pronta para editar.");
}


  function getSystemPrompt() {
    const personality = settings.personality === "Personalizada"
      ? settings.customPersonality || "Amigável e carinhosa"
      : settings.personality;

    return `
Você é a LUMI, uma inteligência artificial que conversa em português brasileiro.

Sua personalidade: ${personality}.

Nível de filtro solicitado pelo usuário: ${settings.filter}%.

Use respostas naturais, claras e úteis.
Respeite as regras de segurança e não produza conteúdo perigoso.

Quando o usuário solicitar histórias:
- Crie títulos interessantes.
- Use capítulos quando fizer sentido.
- Escreva de forma envolvente.
- Adapte o tamanho ao pedido do usuário.

Seja amigável e respeite o contexto da conversa.
`;
  }
function getPersonalityKey() {
  const personality = settings.personality.toLowerCase();

  if (personality.includes("profissional")) {
    return "profissional";
  }

  if (personality.includes("divertida")) {
    return "divertida";
  }

  if (personality.includes("professora")) {
    return "professora";
  }

  return "amigavel";
}

  async function callAI(messagesToSend = messages) {
  // Busca a sessão atual do Supabase
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    throw new Error("Não foi possível verificar seu login.");
  }

  const session = data.session;

  if (!session) {
    throw new Error("Faça login para conversar com a LUMI.");
  }

  lumiSession = session;

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`
    },
    body: JSON.stringify({
  messages: messagesToSend.slice(-15),
  personality: getPersonalityKey(),
  systemPrompt: getSystemPrompt(),
  settings: {
    memory: settings.memory,
    filter: settings.filter
  }
})
  });

  if (!response.ok) {
    let errorMessage = "Não foi possível conversar com a LUMI.";

    try {
      const error = await response.json();
      errorMessage = error.error || error.message || errorMessage;
    } catch {}

    throw new Error(errorMessage);
  }

  const result = await response.json();

  if (!result.reply || typeof result.reply !== "string") {
    throw new Error("O servidor retornou uma resposta inválida.");
  }

  return result.reply;
}

  async function sendMessage(text) {
    text = text.trim();

    if (!text || busy) return;

    if (editingChatId) {
  currentChatId = editingChatId;
  editingChatId = null;
} else if (!currentChatId) {
  currentChatId = crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now());
    }

    busy = true;
    $("sendBtn").disabled = true;

    messages.push({role: "user", content: text});
    renderMessages();
    saveCurrentChat();

    $("typing").hidden = false;

    try {
      const answer = await callAI();

      messages.push({
  role: "assistant",
  content: answer,
  versions: [answer],
  versionIndex: 0
});

      saveCurrentChat();
      renderMessages();

    } catch (error) {
      console.error("Erro LUMI:", error);

      messages.push({
        role: "assistant",
        content: "⚠️ Não consegui me conectar ao servidor da LUMI.\n\n" +
          error.message +
          "\n\nVerifique se o backend está funcionando."
      });

      renderMessages();
    } finally {
      $("typing").hidden = true;
      $("sendBtn").disabled = false;
      busy = false;
      $("messageInput").focus();
    }
  }

  // CONFIGURAÇÕES

  $("settingsBtn").addEventListener("click", () => {
    applySettings();
    $("settingsOverlay").classList.add("open");
  });

  $("closeSettings").addEventListener("click", () => {
    $("settingsOverlay").classList.remove("open");
  });

  $("settingsOverlay").addEventListener("click", event => {
    if (event.target === $("settingsOverlay")) {
      $("settingsOverlay").classList.remove("open");
    }
  });

  document.querySelectorAll(".theme-choice").forEach(button => {
    button.addEventListener("click", () => {
      settings.theme = button.dataset.theme;
      applySettings();
    });
  });

  $("fontSize").addEventListener("input", event => {
    settings.fontSize = Number(event.target.value);
    $("fontValue").textContent = settings.fontSize + "px";
    document.documentElement.style.setProperty(
      "--chat-font", settings.fontSize + "px"
    );
  });

  $("filterLevel").addEventListener("input", event => {
    settings.filter = Number(event.target.value);
    $("filterValue").textContent = settings.filter + "%";
  });

$("saveSettings").addEventListener("click", async () => {
  const newName = $("accountName").value.trim();

  if (currentUser && currentUser.id) {
    if (!newName) {
      showToast("Digite seu nome.");
      return;
    }

    const { error } = await supabaseClient
      .from("profiles")
      .update({
        display_name: newName,
        updated_at: new Date().toISOString()
      })
      .eq("id", currentUser.id);

    if (error) {
      console.error("Erro ao atualizar perfil:", error);
      showToast("Não foi possível atualizar seu nome.");
      return;
    }

    const { error: authError } = await supabaseClient.auth.updateUser({
      data: { name: newName }
    });

    if (authError) {
      console.error("Erro ao atualizar nome da conta:", authError);
    }

    currentUser.name = newName;
    write(KEYS.session, currentUser);
    loadAccount();
  }

  settings.personality = $("personality").value;
  settings.customPersonality = $("customPersonality").value.trim();
  settings.memory = $("memoryEnabled").checked;

  write(KEYS.settings, settings);
  applySettings();

  $("settingsOverlay").classList.remove("open");
  showToast("Configurações salvas! ✦");
});

  

$("clearMemory").addEventListener("click", async () => {
  if (!confirm("Deseja apagar todas as memórias da LUMI?")) return;

  if (!currentUser || !currentUser.id) {
    showToast("Entre na sua conta primeiro.");
    return;
  }

  try {
    const { error } = await supabaseClient
      .from("memories")
      .delete()
      .eq("user_id", currentUser.id);

    if (error) throw error;

    localStorage.removeItem(userKey(KEYS.memories));

    showToast("Todas as memórias foram apagadas! ✦");

  } catch (error) {
    console.error("Erro ao apagar memórias:", error);
    showToast("Não foi possível apagar as memórias.");
  }
});


  // MENU LATERAL

  $("menuToggle").addEventListener("click", () => {
    $("sidebar").classList.add("open");
  });

  $("closeSidebar").addEventListener("click", () => {
    $("sidebar").classList.remove("open");
  });

  $("newChat").addEventListener("click", createChat);

  $("chatNav").addEventListener("click", () => {
    showingFavorites = false;
    $("chatNav").classList.add("active");
    $("favoritesNav").classList.remove("active");
    renderHistory();
  });

  $("favoritesNav").addEventListener("click", () => {
    showingFavorites = true;
    $("favoritesNav").classList.add("active");
    $("chatNav").classList.remove("active");
    renderHistory();
  });

  $("accountBtn").addEventListener("click", () => {
    if (!currentUser) {
      openAuth();
      return;
    }

    $("settingsOverlay").classList.add("open");
  });

$("changePasswordBtn").addEventListener("click", async () => {
  const newPassword = $("newPassword").value;

  if (!newPassword || newPassword.length < 6) {
    showToast("A senha precisa ter pelo menos 6 caracteres.");
    return;
  }

  if (!currentUser) {
    showToast("Entre na sua conta primeiro.");
    return;
  }

  try {
    const { error } = await supabaseClient.auth.updateUser({
      password: newPassword
    });

    if (error) throw error;

    $("newPassword").value = "";
    showToast("Senha alterada com sucesso! ✦");

  } catch (error) {
    console.error("Erro ao alterar senha:", error);
    showToast(error.message || "Não foi possível alterar a senha.");
  }
});


  // CHAT

  $("chatForm").addEventListener("submit", event => {
    event.preventDefault();

    const input = $("messageInput");
    const text = input.value;

    if (!text.trim()) return;

    input.value = "";
    input.style.height = "auto";
    sendMessage(text);
  });

  $("messageInput").addEventListener("input", event => {
    event.target.style.height = "auto";
    event.target.style.height =
      Math.min(event.target.scrollHeight, 140) + "px";
  });

  document.querySelectorAll(".suggestion").forEach(button => {
    button.addEventListener("click", () => {
      sendMessage(button.dataset.prompt);
    });
  });
// LOGIN E CADASTRO COM SUPABASE

let lumiSession = null;

function openAuth() {
authMode = "login";
updateAuthScreen();
$("authOverlay").classList.add("open");
}

function updateAuthScreen() {
const register = authMode === "register";

$("authTitle").textContent = register  
  ? "Crie sua conta"  
  : "Bem-vindo à LUMI";  

$("authSubtitle").textContent = register  
  ? "Comece sua experiência com a LUMI."  
  : "Entre na sua conta para continuar.";  

$("nameField").hidden = !register;  
$("authName").required = register;  
$("authSubmit").textContent = register ? "Criar conta" : "Entrar";  

$("authSwitchText").textContent = register  
  ? "Já tem uma conta?"  
  : "Ainda não tem conta?";  

$("authSwitch").textContent = register  
  ? "Entrar"  
  : "Criar conta";

}

$("authSwitch").addEventListener("click", () => {
authMode = authMode === "login" ? "register" : "login";
updateAuthScreen();
});

$("authForm").addEventListener("submit", async event => {
event.preventDefault();

const email = $("authEmail").value.trim().toLowerCase();  
const password = $("authPassword").value;  
const name = $("authName").value.trim();  

try {  
  if (authMode === "register") {  
    if (!name) return showToast("Digite seu nome.");  

    const { data, error } = await supabaseClient.auth.signUp({  
      email,  
      password,  
      options: {  
        data: { name }  
      }  
    });  

    if (error) throw error;  

    if (!data.session) {  
      showToast("Cadastro criado! Verifique seu e-mail para confirmar a conta.");  
      return;  
    }  

    await loginUser(data.session);  
    showToast("Conta criada com sucesso!");  

  } else {  
    const { data, error } =  
      await supabaseClient.auth.signInWithPassword({  
        email,  
        password  
      });  

    if (error) throw error;  

    await loginUser(data.session);  
    showToast("Bem-vindo de volta!");  
  }  

  $("authForm").reset();  

} catch (error) {  
  console.error("Erro de autenticação:", error);  
  showToast(error.message || "Não foi possível entrar.");  
}

});

async function loadConversationsFromSupabase() {
if (!currentUser || !currentUser.id) return;

const { data: chats, error: chatError } = await supabaseClient
.from("conversations")
.select("id, title, updated_at, favorite")
.eq("user_id", currentUser.id)
.order("updated_at", { ascending: false });

if (chatError) throw chatError;

if (!chats || chats.length === 0) {
loadConversations();
return;
}

const ids = chats.map(chat => chat.id);

const { data: savedMessages, error: messagesError } =
await supabaseClient
.from("messages")
.select("conversation_id, role, content, created_at")
.in("conversation_id", ids)
.eq("user_id", currentUser.id)
.order("created_at", { ascending: true });

if (messagesError) throw messagesError;

conversations = chats.map(chat => ({
id: chat.id,
title: chat.title,
messages: (savedMessages || [])
.filter(message => message.conversation_id === chat.id)
.map(message => ({
role: message.role,
content: message.content
})),
favorite: chat.favorite,
updatedAt: new Date(chat.updated_at).getTime()
}));

renderHistory();
}

async function loginUser(session) {
lumiSession = session;

const user = session.user;
const { data: profileData, error: profileError } =
await supabaseClient
.from("profiles")
.upsert({
id: user.id,
display_name: user.user_metadata?.name || user.email,
updated_at: new Date().toISOString()
})
.select();

if (profileError) {
console.error("ERRO AO SALVAR PERFIL:", profileError);
showToast("Erro ao salvar perfil: " + profileError.message);
} else {
console.log("PERFIL SALVO:", profileData);
}

currentUser = {
id: user.id,
name: user.user_metadata?.name || user.email,
email: user.email
};

write(KEYS.session, currentUser);

conversations = [];
currentChatId = null;
messages = [];

try {
await loadConversationsFromSupabase();
} catch (error) {
console.error("Erro ao recuperar conversas:", error);
loadConversations();
showToast("Não consegui carregar o histórico da nuvem.");
}

loadAccount();
loadCredits();
renderMessages();

$("authOverlay").classList.remove("open");
}

$("guestBtn").addEventListener("click", () => {
currentUser = null;
lumiSession = null;
localStorage.removeItem(KEYS.session);

conversations = [];  
messages = [];  
currentChatId = null;  

loadConversations();  
loadAccount();  
renderMessages();  

$("authOverlay").classList.remove("open");  
showToast("Você está usando a LUMI como visitante.");

});

$("logoutBtn").addEventListener("click", async () => {
if (!confirm("Deseja sair da sua conta?")) return;

try {  
  const { error } = await supabaseClient.auth.signOut();  
  if (error) throw error;  

  currentUser = null;  
  lumiSession = null;  
  localStorage.removeItem(KEYS.session);  

  conversations = [];  
  messages = [];  
  currentChatId = null;  

  loadConversations();  
  loadAccount();  
  renderMessages();  

  $("settingsOverlay").classList.remove("open");  
  openAuth();  

} catch (error) {  
  console.error("Erro ao sair:", error);  
  showToast("Não foi possível sair da conta.");  
}

});

// INICIALIZAÇÃO

applySettings();

(async function initializeLumi() {
try {
const { data, error } = await supabaseClient.auth.getSession();

if (error) throw error;  

if (data.session) {  
  await loginUser(data.session);  
} else {  
  currentUser = null;  
  lumiSession = null;  
  localStorage.removeItem(KEYS.session);  

  conversations = [];  
  messages = [];  
  currentChatId = null;  

  loadAccount();  
  renderHistory();  
  openAuth();  
}  

renderMessages();

} catch (error) {
console.error("Erro ao recuperar sessão:", error);
showToast("Não foi possível verificar seu login.");
openAuth();
}
})();

console.log("✦ LUMI inicializada!");
});
  
