// DOM Elements
const messagesContainer = document.getElementById("messages")
const messageInput = document.getElementById("message-input")
const sendButton = document.getElementById("send-button")
const emojiButton = document.getElementById("emoji-button")
const fileButton = document.getElementById("file-button")
const fileUpload = document.getElementById("file-upload")
const filePreview = document.getElementById("file-preview")
const fileName = document.getElementById("file-name")
const fileSize = document.getElementById("file-size")
const removeFile = document.getElementById("remove-file")
const emojiPicker = document.getElementById("emoji-picker")
const connectWalletButton = document.getElementById("connect-wallet")
const disconnectWalletButton = document.getElementById("disconnect-wallet")
const walletInfo = document.getElementById("wallet-info")
const walletAddressElement = document.getElementById("wallet-address")
const displayNameElement = document.getElementById("display-name")
const userAvatarElement = document.getElementById("user-avatar")
const connectionStatus = document.getElementById("connection-status")
const statusText = document.getElementById("status-text")
const chainIdElement = document.getElementById("chain-id")
const latestBlockElement = document.getElementById("latest-block")
const gasPriceElement = document.getElementById("gas-price")
const roomsList = document.getElementById("rooms-list")
const activeUsersList = document.getElementById("active-users-list")
const currentRoomName = document.getElementById("current-room-name")
const roomDescription = document.getElementById("room-description")
const themeToggle = document.getElementById("theme-toggle")
const mobileMenuToggle = document.getElementById("mobile-menu-toggle")
const sidebar = document.querySelector(".sidebar")
const typingIndicator = document.getElementById("typing-indicator")
const messageContextMenu = document.getElementById("message-context-menu")

// Profile Elements
const profileModal = document.getElementById("profile-modal")
const avatarUpload = document.getElementById("avatar-upload")
const profileAvatarPreview = document.getElementById("profile-avatar-preview")
const displayNameInput = document.getElementById("display-name-input")
const bioInput = document.getElementById("bio-input")
const saveProfileButton = document.getElementById("save-profile")

// Friend System Elements
const searchUserInput = document.getElementById("search-user-input")
const searchUserResults = document.getElementById("search-user-results")
const friendsList = document.getElementById("friends-list")
const friendRequestsList = document.getElementById("friend-requests-list")
const privateChatsList = document.getElementById("private-chats-list")

// App State
let currentAccount = null
let web3 = null
let isPolygonNetwork = false
const POLYGON_CHAIN_ID = "0x89" // 137 in decimal
let currentRoom = "General"
let currentPrivateRoom = null
let rooms = {}
let activeUsers = {}
let friends = []
let friendRequests = []
let privateChats = []
let blockedUsers = []
let hiddenRooms = []
let isEmojiPickerOpen = false
let selectedFile = null
let socket = null
let typingTimeout = null
let userProfile = null
let contextMenuTarget = null
let avatarFile = null
let isChatPrivate = false

// Initialize the app
async function initApp() {
  // Load theme preference
  loadThemePreference()

  // Initialize WebSocket connection
  initializeSocket()

  // Check if MetaMask is installed
  if (checkMetaMaskInstallation()) {
    web3 = new Web3(window.ethereum)

    // Check if user is already connected (restore session)
    try {
      // Check localStorage for saved wallet
      const savedWallet = localStorage.getItem('currentWallet')
      if (savedWallet) {
        currentAccount = savedWallet
        console.log("Restored wallet from localStorage:", currentAccount)
        
        // Load user profile
        await loadUserProfile()
        
        // Update UI
        updateWalletUI()
        
        // Update user presence
        updateUserPresence()
        
        // Load friends and requests
        loadFriends()
        loadFriendRequests()
        loadPrivateChats()
        loadBlockedUsers()
        
        // Join user's personal room for notifications
        if (socket && socket.connected) {
          socket.emit("join", {
            type: "user",
            roomId: currentAccount,
          })
        }
      } else {
        // Check if MetaMask is connected
        const accounts = await web3.eth.getAccounts()
        console.log("Initial accounts check:", accounts)
        if (accounts.length > 0) {
          handleAccountsChanged(accounts)
        }
      }
    } catch (error) {
      console.error("Error checking accounts:", error)
    }

    // Setup event listeners
    window.ethereum.on("accountsChanged", handleAccountsChanged)
    window.ethereum.on("chainChanged", handleChainChanged)

    // Setup UI event listeners
    setupEventListeners()

    // Start polling for network status
    pollNetworkStatus()

    // Load rooms
    loadRooms()

    // Start polling for active users
    pollActiveUsers()
  }

  // Load initial messages
  loadMessages()

  // Setup context menu
  setupContextMenu()
}

// Initialize WebSocket connection
function initializeSocket() {
  // Get the server URL dynamically
  const serverUrl = window.location.origin
  socket = io(serverUrl)

  // Socket event listeners
  socket.on("connect", () => {
    console.log("Connected to WebSocket server")
    // Join the current room
    if (currentAccount) {
      // Join user's personal room for notifications
      socket.emit("join", {
        type: "user",
        roomId: currentAccount,
      })

      // Join current public room
      socket.emit("join", {
        type: "public",
        roomId: currentRoom,
      })

      // Join private room if active
      if (currentPrivateRoom) {
        socket.emit("join", {
          type: "private",
          roomId: currentPrivateRoom,
        })
      }
    }
  })

  socket.on("disconnect", () => {
    console.log("Disconnected from WebSocket server")
  })

  socket.on("new_message", (message) => {
    console.log("New message received:", message)
    
    // Check if sender is blocked
    if (isUserBlocked(message.walletAddress)) {
      console.log("Message from blocked user ignored:", message.walletAddress)
      return
    }
    
    // Check if message is for current room or private chat
    if (
      (isChatPrivate && message.privateRoomId === currentPrivateRoom) ||
      (!isChatPrivate && message.roomId === currentRoom)
    ) {
      addMessageToUI(message)
      // Scroll to bottom
      messagesContainer.scrollTop = messagesContainer.scrollHeight
    }
  })

  socket.on("message_deleted", (data) => {
    console.log("Message deleted:", data)
    const messageElement = document.querySelector(`.message[data-id="${data.messageId}"]`)
    if (messageElement) {
      if (data.deleteForAll) {
        // Mark as deleted for everyone
        messageElement.classList.add("deleted")
        messageElement.querySelector(".message-content").textContent = "This message was deleted"
        // Remove any images or files
        const imageElement = messageElement.querySelector(".message-image")
        if (imageElement) imageElement.remove()
        const fileElement = messageElement.querySelector(".message-file")
        if (fileElement) fileElement.remove()
      } else if (data.walletAddress !== currentAccount) {
        // Only delete for the sender
        return
      } else {
        // Remove the message from the UI for the current user
        messageElement.remove()
      }
    }
  })

  socket.on("user_typing", (data) => {
    if (data.userId !== currentAccount && !isUserBlocked(data.userId)) {
      if (data.isTyping) {
        // Show typing indicator
        const userName = data.displayName || `User ${data.userId.substring(0, 6)}`
        document.querySelector(".typing-text").textContent = `${userName} is typing...`
        typingIndicator.classList.remove("hidden")
      } else {
        // Hide typing indicator
        typingIndicator.classList.add("hidden")
      }
    }
  })

  socket.on("user_connected", (data) => {
    console.log("User connected:", data)
    if (!isUserBlocked(data.userId)) {
      showNotification(`${data.name} joined the chat`, "info")
    }
  })

  socket.on("user_disconnected", (data) => {
    console.log("User disconnected:", data)
    if (activeUsers[data.userId] && !isUserBlocked(data.userId)) {
      showNotification(`${activeUsers[data.userId].name} left the chat`, "info")
    }
  })

  socket.on("profile_updated", (profile) => {
    console.log("Profile updated:", profile)
    
    // Skip updates from blocked users
    if (isUserBlocked(profile.walletAddress)) return
    
    // Update active users list if needed
    if (activeUsers[profile.walletAddress]) {
      activeUsers[profile.walletAddress].displayName = profile.displayName
      activeUsers[profile.walletAddress].avatar = profile.avatar
      updateActiveUsersList()
    }

    // Update messages from this user
    const userMessages = document.querySelectorAll(`.message[data-wallet="${profile.walletAddress}"]`)
    userMessages.forEach((messageElement) => {
      const avatarImg = messageElement.querySelector(".message-avatar img")
      const senderElement = messageElement.querySelector(".message-sender")

      if (avatarImg) avatarImg.src = profile.avatar
      if (senderElement) senderElement.textContent = profile.displayName
    })

    // Update current user's profile if it's their own
    if (profile.walletAddress === currentAccount) {
      userProfile = profile
      displayNameElement.textContent = profile.displayName
      userAvatarElement.src = profile.avatar
      
      // Save profile to localStorage for persistence
      localStorage.setItem('userProfile', JSON.stringify(profile))
    }

    // Update friends list if needed
    updateFriendsList()
  })

  // Friend system events
  socket.on("friend_request", (data) => {
    console.log("Friend request received:", data)
    if (!isUserBlocked(data.senderId)) {
      showNotification(`${data.senderName} sent you a friend request`, "info")
      // Reload friend requests
      loadFriendRequests()
    }
  })

  socket.on("friend_request_accepted", (data) => {
    console.log("Friend request accepted:", data)
    if (!isUserBlocked(data.receiverId)) {
      showNotification(`${data.receiverName} accepted your friend request`, "success")
      // Reload friends list
      loadFriends()
      // Reload private chats
      loadPrivateChats()
    }
  })

  socket.on("friend_request_rejected", (data) => {
    console.log("Friend request rejected:", data)
    showNotification(`Your friend request was rejected`, "info")
    // Reload friend requests
    loadFriendRequests()
  })
  
  // Room deleted event
  socket.on("room_deleted", (data) => {
    console.log("Room deleted:", data)
    showNotification(`Room "${data.roomName}" was deleted`, "info")
    
    // If current room was deleted, switch to General
    if (currentRoom === data.roomId || currentRoom === data.roomName) {
      switchRoom("General")
    }
    
    // Reload rooms
    loadRooms()
  })
}

// Setup UI event listeners
function setupEventListeners() {
  connectWalletButton.addEventListener("click", connectWallet)
  document.getElementById("edit-profile").addEventListener("click", showProfileModal)

  // Edit Profile Events
  document.getElementById("change-avatar").addEventListener("click", () => avatarUpload.click())
  avatarUpload.addEventListener("change", handleAvatarSelect)
  saveProfileButton.addEventListener("click", saveProfile)
  document.getElementById("close-profile-modal").addEventListener("click", () => profileModal.classList.add("hidden"))

  disconnectWalletButton.addEventListener("click", disconnectWallet)
  sendButton.addEventListener("click", sendMessage)
  messageInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  })

  // Typing indicator
  messageInput.addEventListener("input", () => {
    // Emit typing event
    if (socket && currentAccount) {
      socket.emit("typing", {
        userId: currentAccount,
        roomId: isChatPrivate ? currentPrivateRoom : currentRoom,
        type: isChatPrivate ? "private" : "public",
        isTyping: true,
      })

      // Clear previous timeout
      if (typingTimeout) clearTimeout(typingTimeout)

      // Set new timeout to stop typing indicator after 2 seconds
      typingTimeout = setTimeout(() => {
        socket.emit("typing", {
          userId: currentAccount,
          roomId: isChatPrivate ? currentPrivateRoom : currentRoom,
          type: isChatPrivate ? "private" : "public",
          isTyping: false,
        })
      }, 2000)
    }
  })

  emojiButton.addEventListener("click", toggleEmojiPicker)
  document.addEventListener("click", (e) => {
    if (isEmojiPickerOpen && !emojiPicker.contains(e.target) && e.target !== emojiButton) {
      emojiPicker.classList.add("hidden")
      isEmojiPickerOpen = false
    }
  })

  // File upload
  fileButton.addEventListener("click", () => {
    fileUpload.click()
  })

  fileUpload.addEventListener("change", handleFileSelect)

  removeFile.addEventListener("click", () => {
    clearFileSelection()
  })

  themeToggle.addEventListener("click", toggleTheme)
  mobileMenuToggle.addEventListener("click", toggleMobileMenu)

  // Friend system event listeners
  if (searchUserInput) {
    searchUserInput.addEventListener("input", debounce(searchUsers, 500))

    // Add search button click handler
    const searchButton = document.getElementById("search-button")
    if (searchButton) {
      searchButton.addEventListener("click", searchUsers)
    }
  }

  // Close modals
  document.querySelectorAll(".close-modal").forEach((button) => {
    button.addEventListener("click", () => {
      const modal = button.closest(".modal")
      if (modal) {
        modal.classList.add("hidden")
      }
    })
  })
  
  // Add context menu items for blocking/unblocking
  const contextMenu = document.getElementById("message-context-menu")
  if (contextMenu) {
    // Add block/unblock option if it doesn't exist
    if (!document.getElementById("context-block-user")) {
      const blockItem = document.createElement("li")
      blockItem.id = "context-block-user"
      blockItem.textContent = "Block user"
      blockItem.addEventListener("click", () => {
        if (contextMenuTarget) {
          const walletAddress = contextMenuTarget.dataset.wallet
          blockUser(walletAddress)
        }
      })
      contextMenu.querySelector("ul").appendChild(blockItem)
    }
    
    // Add room deletion option if it doesn't exist
    if (!document.getElementById("context-delete-room")) {
      const deleteRoomItem = document.createElement("li")
      deleteRoomItem.id = "context-delete-room"
      deleteRoomItem.textContent = "Delete room"
      deleteRoomItem.style.display = "none" // Hide by default
      deleteRoomItem.addEventListener("click", () => {
        deleteRoom(currentRoom)
      })
      contextMenu.querySelector("ul").appendChild(deleteRoomItem)
    }
  }
  
  // Add room context menu
  document.addEventListener("contextmenu", (e) => {
    const roomElement = e.target.closest(".room")
    if (roomElement) {
      e.preventDefault()
      
      // Create room context menu if it doesn't exist
      let roomContextMenu = document.getElementById("room-context-menu")
      if (!roomContextMenu) {
        roomContextMenu = document.createElement("div")
        roomContextMenu.id = "room-context-menu"
        roomContextMenu.className = "context-menu"
        roomContextMenu.innerHTML = `
          <ul>
            <li id="context-hide-room">Hide room</li>
          </ul>
        `
        document.body.appendChild(roomContextMenu)
        
        // Add event listener for hiding room
        document.getElementById("context-hide-room").addEventListener("click", () => {
          const roomName = roomContextMenu.dataset.room
          hideRoom(roomName)
          roomContextMenu.classList.add("hidden")
        })
      }
      
      // Set position and show menu
      roomContextMenu.style.top = `${e.pageY}px`
      roomContextMenu.style.left = `${e.pageX}px`
      roomContextMenu.classList.remove("hidden")
      roomContextMenu.dataset.room = roomElement.dataset.room
      
      // Hide menu when clicking elsewhere
      const hideMenu = () => {
        roomContextMenu.classList.add("hidden")
        document.removeEventListener("click", hideMenu)
      }
      setTimeout(() => {
        document.addEventListener("click", hideMenu)
      }, 0)
    }
  })
}

// Hide room
async function hideRoom(roomName) {
  try {
    if (!currentAccount) return
    
    // Find room ID
    let roomId = roomName
    if (rooms[roomName]) {
      roomId = rooms[roomName].id
    }
    
    // Call API to delete/hide room
    const response = await fetch(`/api/rooms/${roomId}?walletAddress=${currentAccount}`, {
      method: "DELETE"
    })
    
    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`)
    }
    
    const data = await response.json()
    console.log("Room hidden:", data)
    
    // If current room was hidden, switch to another room
    if (currentRoom === roomName) {
      // Find first available room
      const availableRooms = Object.keys(rooms).filter(r => r !== roomName)
      if (availableRooms.length > 0) {
        switchRoom(availableRooms[0])
      }
    }
    
    // Reload rooms
    loadRooms()
    
    showNotification(`Room "${roomName}" hidden`, "success")
  } catch (error) {
    console.error("Error hiding room:", error)
    showNotification("Failed to hide room", "error")
  }
}

// Load hidden rooms
async function loadHiddenRooms() {
  try {
    if (!currentAccount) return
    
    const response = await fetch(`/api/rooms/hidden?walletAddress=${currentAccount}`)
    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`)
    }
    
    hiddenRooms = await response.json()
    
    // Update UI to show hidden rooms if needed
    updateHiddenRoomsList()
  } catch (error) {
    console.error("Error loading hidden rooms:", error)
  }
}

// Update hidden rooms list UI
function updateHiddenRoomsList() {
  // Create hidden rooms section if it doesn't exist
  let hiddenRoomsSection = document.querySelector(".hidden-rooms-section")
  if (!hiddenRoomsSection && hiddenRooms.length > 0) {
    hiddenRoomsSection = document.createElement("div")
    hiddenRoomsSection.className = "hidden-rooms-section"
    hiddenRoomsSection.innerHTML = `
      <h2>Hidden Rooms</h2>
      <ul id="hidden-rooms-list" class="hidden-rooms-list"></ul>
    `
    
    // Insert after rooms section
    const roomsSection = document.querySelector(".rooms-section")
    if (roomsSection) {
      roomsSection.parentNode.insertBefore(hiddenRoomsSection, roomsSection.nextSibling)
    }
  } else if (hiddenRoomsSection && hiddenRooms.length === 0) {
    hiddenRoomsSection.remove()
    return
  }
  
  // If section exists but no rooms, return
  if (hiddenRooms.length === 0) return
  
  // Update list
  const hiddenRoomsList = document.getElementById("hidden-rooms-list")
  if (hiddenRoomsList) {
    hiddenRoomsList.innerHTML = ""
    
    hiddenRooms.forEach(room => {
      const roomElement = document.createElement("li")
      roomElement.className = "hidden-room"
      roomElement.dataset.room = room.id
      roomElement.innerHTML = `
        <span class="room-icon">#</span>
        <span class="room-name">${room.name}</span>
        <button class="unhide-room-button" data-room="${room.id}">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </button>
      `
      
      // Add event listener for unhiding
      roomElement.querySelector(".unhide-room-button").addEventListener("click", (e) => {
        e.stopPropagation()
        unhideRoom(room.id)
      })
      
      hiddenRoomsList.appendChild(roomElement)
    })
  }
}

// Unhide room
async function unhideRoom(roomId) {
  try {
    if (!currentAccount) return
    
    const response = await fetch(`/api/rooms/unhide`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        walletAddress: currentAccount,
        roomId: roomId
      })
    })
    
    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`)
    }
    
    const data = await response.json()
    console.log("Room unhidden:", data)
    
    // Reload rooms and hidden rooms
    loadRooms()
    loadHiddenRooms()
    
    showNotification("Room unhidden", "success")
  } catch (error) {
    console.error("Error unhiding room:", error)
    showNotification("Failed to unhide room", "error")
  }
}

// Block user
async function blockUser(userId) {
  try {
    if (!currentAccount || userId === currentAccount) return
    
    const response = await fetch("/api/users/block", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        blockerId: currentAccount,
        blockedId: userId
      })
    })
    
    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`)
    }
    
    const data = await response.json()
    console.log("User blocked:", data)
    
    // Reload blocked users
    loadBlockedUsers()
    
    // Remove messages from blocked user
    const userMessages = document.querySelectorAll(`.message[data-wallet="${userId}"]`)
    userMessages.forEach(msg => {
      msg.classList.add("blocked-message")
      msg.innerHTML = "<div class='message-content'>Message from blocked user</div>"
    })
    
    showNotification("User blocked", "success")
  } catch (error) {
    console.error("Error blocking user:", error)
    showNotification("Failed to block user", "error")
  }
}

// Unblock user
async function unblockUser(userId) {
  try {
    if (!currentAccount) return
    
    const response = await fetch("/api/users/unblock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        blockerId: currentAccount,
        blockedId: userId
      })
    })
    
    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`)
    }
    
    const data = await response.json()
    console.log("User unblocked:", data)
    
    // Reload blocked users
    loadBlockedUsers()
    
    showNotification("User unblocked", "success")
  } catch (error) {
    console.error("Error unblocking user:", error)
    showNotification("Failed to unblock user", "error")
  }
}

// Load blocked users
async function loadBlockedUsers() {
  try {
    if (!currentAccount) return
    
    const response = await fetch(`/api/users/blocked?walletAddress=${currentAccount}`)
    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`)
    }
    
    blockedUsers = await response.json()
    
    // Update UI to show blocked users
    updateBlockedUsersList()
  } catch (error) {
    console.error("Error loading blocked users:", error)
  }
}

// Update blocked users list UI
function updateBlockedUsersList() {
  // Create blocked users section if it doesn't exist
  let blockedUsersSection = document.querySelector(".blocked-users-section")
  if (!blockedUsersSection && blockedUsers.length > 0) {
    blockedUsersSection = document.createElement("div")
    blockedUsersSection.className = "blocked-users-section"
    blockedUsersSection.innerHTML = `
      <h2>Blocked Users</h2>
      <div id="blocked-users-list" class="blocked-users-list"></div>
    `
    
    // Insert after active users section
    const activeUsersSection = document.querySelector(".active-users-section")
    if (activeUsersSection) {
      activeUsersSection.parentNode.insertBefore(blockedUsersSection, activeUsersSection.nextSibling)
    }
  } else if (blockedUsersSection && blockedUsers.length === 0) {
    blockedUsersSection.remove()
    return
  }
  
  // If section exists but no blocked users, return
  if (blockedUsers.length === 0) return
  
  // Update list
  const blockedUsersList = document.getElementById("blocked-users-list")
  if (blockedUsersList) {
    blockedUsersList.innerHTML = ""
    
    blockedUsers.forEach(user => {
      const userElement = document.createElement("div")
      userElement.className = "blocked-user-item"
      userElement.innerHTML = `
        <div class="user-avatar">
          <img src="${user.avatar}" alt="${user.displayName}">
        </div>
        <div class="user-info">
          <span class="user-name">${user.displayName}</span>
          <span class="user-wallet">${user.userId.substring(0, 6)}...${user.userId.substring(38)}</span>
        </div>
        <button class="unblock-user-button" data-user="${user.userId}">Unblock</button>
      `
      
      // Add event listener for unblocking
      userElement.querySelector(".unblock-user-button").addEventListener("click", () => {
        unblockUser(user.userId)
      })
      
      blockedUsersList.appendChild(userElement)
    })
  }
}

// Check if user is blocked
function isUserBlocked(userId) {
  return blockedUsers.some(user => user.userId === userId)
}

// Debounce function for search
function debounce(func, wait) {
  let timeout
  return function (...args) {
    clearTimeout(timeout)
    timeout = setTimeout(() => func.apply(this, args), wait)
  }
}

// Search users by wallet address
async function searchUsers() {
  const query = searchUserInput.value.trim()
  if (query.length < 3) {
    searchUserResults.innerHTML = "<p>Type at least 3 characters to search</p>"
    return
  }

  try {
    console.log("Searching for users with query:", query)
    const response = await fetch(`/api/users/search?query=${encodeURIComponent(query)}`)

    if (!response.ok) {
      const errorData = await response.text()
      console.error(`Server responded with status: ${response.status}`, errorData)
      throw new Error(`Server responded with status: ${response.status}`)
    }

    const users = await response.json()
    console.log("Search results:", users)

    if (users.length === 0) {
      searchUserResults.innerHTML = "<p>No users found</p>"
      return
    }

    searchUserResults.innerHTML = ""
    users.forEach((user) => {
      if (user.walletAddress === currentAccount) return // Skip current user
      
      // Skip blocked users
      if (isUserBlocked(user.walletAddress)) return

      const userElement = document.createElement("div")
      userElement.classList.add("search-result-item")
      userElement.innerHTML = `
        <div class="user-avatar">
          <img src="${user.avatar}" alt="${user.displayName}">
        </div>
        <div class="user-info">
          <span class="user-name">${user.displayName}</span>
          <span class="user-wallet">${user.walletAddress.substring(0, 6)}...${user.walletAddress.substring(38)}</span>
        </div>
        <button class="add-friend-button" data-wallet="${user.walletAddress}">Add Friend</button>
      `

      const addButton = userElement.querySelector(".add-friend-button")
      addButton.addEventListener("click", () => sendFriendRequest(user.walletAddress))

      searchUserResults.appendChild(userElement)
    })
  } catch (error) {
    console.error("Error searching users:", error)
    searchUserResults.innerHTML = `<p>Error searching users: ${error.message}</p>`
  }
}

// Send friend request
async function sendFriendRequest(receiverId) {
    try {
        if (!currentAccount) {
            showNotification("Wallet not connected", "error");
            return;
        }
        
        const response = await fetch("/api/friends/request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                senderId: currentAccount,
                receiverId: receiverId
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Failed to send request");
        }

        showNotification("Friend request sent", "success");
    } catch (error) {
        console.error("Error sending friend request:", error);
        showNotification(error.message, "error");
    }
}

// Load friend requests
async function loadFriendRequests() {
  try {
    if (!currentAccount) return

    const response = await fetch(`/api/friends/requests?walletAddress=${currentAccount}&type=received`)
    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`)
    }

    friendRequests = await response.json()
    updateFriendRequestsList()
  } catch (error) {
    console.error("Error loading friend requests:", error)
  }
}

// Update friend requests list UI
function updateFriendRequestsList() {
  if (!friendRequestsList) return

  friendRequestsList.innerHTML = ""

  if (friendRequests.length === 0) {
    friendRequestsList.innerHTML = "<p>No pending friend requests</p>"
    return
  }

  friendRequests.forEach((request) => {
    // Skip requests from blocked users
    if (isUserBlocked(request.senderId)) return
    
    const requestElement = document.createElement("div")
    requestElement.classList.add("friend-request-item")
    requestElement.innerHTML = `
            <div class="user-avatar">
                <img src="${request.senderAvatar}" alt="${request.senderName}">
            </div>
            <div class="user-info">
                <span class="user-name">${request.senderName}</span>
                <span class="user-wallet">${request.senderId.substring(0, 6)}...${request.senderId.substring(38)}</span>
            </div>
            <div class="request-actions">
                <button class="accept-request-button" data-sender="${request.senderId}">Accept</button>
                <button class="reject-request-button" data-sender="${request.senderId}">Reject</button>
            </div>
        `

    const acceptButton = requestElement.querySelector(".accept-request-button")
    const rejectButton = requestElement.querySelector(".reject-request-button")

    acceptButton.addEventListener("click", () => handleFriendRequest("accept", request.senderId))
    rejectButton.addEventListener("click", () => handleFriendRequest("reject", request.senderId))

    friendRequestsList.appendChild(requestElement)
  })
}

// Handle friend request (accept/reject)
async function handleFriendRequest(action, senderId) {
  try {
    if (!currentAccount) return

    const response = await fetch(`/api/friends/request/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderId: senderId,
        receiverId: currentAccount,
      }),
    })

    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`)
    }

    const data = await response.json()

    if (action === "accept") {
      showNotification("Friend request accepted", "success")
      // Reload friends list
      loadFriends()
      // Reload private chats
      loadPrivateChats()
    } else {
      showNotification("Friend request rejected", "info")
    }

    // Reload friend requests
    loadFriendRequests()
  } catch (error) {
    console.error(`Error ${action}ing friend request:`, error)
    showNotification(`Failed to ${action} friend request`, "error")
  }
}

// Load friends list
async function loadFriends() {
  try {
    if (!currentAccount) return

    const response = await fetch(`/api/friends?walletAddress=${currentAccount}`)
    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`)
    }

    friends = await response.json()
    updateFriendsList()
  } catch (error) {
    console.error("Error loading friends:", error)
  }
}

// Update friends list UI
function updateFriendsList() {
  if (!friendsList) return

  friendsList.innerHTML = ""

  if (friends.length === 0) {
    friendsList.innerHTML = "<p>No friends yet</p>"
    return
  }

  friends.forEach((friend) => {
    // Skip blocked friends
    if (isUserBlocked(friend.walletAddress)) return
    
    const friendElement = document.createElement("div")
    friendElement.classList.add("friend-item")
    friendElement.innerHTML = `
            <div class="user-avatar">
                <img src="${friend.avatar}" alt="${friend.displayName}">
            </div>
            <div class="user-info">
                <span class="user-name">${friend.displayName}</span>
                <span class="user-wallet">${friend.walletAddress.substring(0, 6)}...${friend.walletAddress.substring(38)}</span>
            </div>
            <div class="friend-actions">
              <button class="chat-with-friend-button" data-wallet="${friend.walletAddress}" data-room="${friend.privateRoomId}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
              </button>
              <button class="block-friend-button" data-wallet="${friend.walletAddress}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
                  </svg>
              </button>
            </div>
        `

    const chatButton = friendElement.querySelector(".chat-with-friend-button")
    chatButton.addEventListener("click", () =>
      openPrivateChat(friend.privateRoomId, friend.walletAddress, friend.displayName),
    )
    
    const blockButton = friendElement.querySelector(".block-friend-button")
    blockButton.addEventListener("click", () => blockUser(friend.walletAddress))

    friendsList.appendChild(friendElement)
  })
}

// Load private chats
async function loadPrivateChats() {
  try {
    if (!currentAccount) return

    const response = await fetch(`/api/private-chats?walletAddress=${currentAccount}`)
    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`)
    }

    privateChats = await response.json()
    updatePrivateChatsList()
  } catch (error) {
    console.error("Error loading private chats:", error)
  }
}

// Update private chats list UI
function updatePrivateChatsList() {
  if (!privateChatsList) return

  privateChatsList.innerHTML = ""

  if (privateChats.length === 0) {
    privateChatsList.innerHTML = "<p>No private chats</p>"
    return
  }

  privateChats.forEach((chat) => {
    // Skip chats with blocked users
    if (isUserBlocked(chat.userId)) return
    
    const chatElement = document.createElement("div")
    chatElement.classList.add("private-chat-item")
    if (currentPrivateRoom === chat.id) {
      chatElement.classList.add("active")
    }
    chatElement.dataset.room = chat.id

    let lastMessageText = "No messages yet"
    if (chat.lastMessage) {
      lastMessageText =
        chat.lastMessage.type === "text"
          ? chat.lastMessage.content.substring(0, 20) + (chat.lastMessage.content.length > 20 ? "..." : "")
          : chat.lastMessage.type === "image"
            ? "Image"
            : "File"
    }

    chatElement.innerHTML = `
            <div class="user-avatar">
                <img src="${chat.avatar}" alt="${chat.displayName}">
            </div>
            <div class="chat-info">
                <span class="user-name">${chat.displayName}</span>
                <span class="last-message">${lastMessageText}</span>
            </div>
        `

    chatElement.addEventListener("click", () => openPrivateChat(chat.id, chat.userId, chat.displayName))

    privateChatsList.appendChild(chatElement)
  })
}

// Open private chat
function openPrivateChat(roomId, userId, displayName) {
  if (currentPrivateRoom === roomId && isChatPrivate) return

  // Leave current room
  if (isChatPrivate) {
    socket.emit("leave", {
      type: "private",
      roomId: currentPrivateRoom,
    })
  } else {
    socket.emit("leave", {
      type: "public",
      roomId: currentRoom,
    })
  }

  // Update UI
  const roomElements = document.querySelectorAll(".room")
  roomElements.forEach((el) => {
    el.classList.remove("active")
  })

  const privateChatElements = document.querySelectorAll(".private-chat-item")
  privateChatElements.forEach((el) => {
    el.classList.remove("active")
  })

  const chatElement = document.querySelector(`.private-chat-item[data-room="${roomId}"]`)
  if (chatElement) {
    chatElement.classList.add("active")
  }

  // Update current room
  currentPrivateRoom = roomId
  isChatPrivate = true

  // Join new room
  socket.emit("join", {
    type: "private",
    roomId: currentPrivateRoom,
  })

  // Update current room name and description
  currentRoomName.textContent = displayName
  roomDescription.textContent = "Private conversation"

  // Load messages for the new room
  loadMessages()

  // Close mobile menu if open
  if (sidebar.classList.contains("active")) {
    sidebar.classList.remove("active")
  }
}

// Setup context menu
function setupContextMenu() {
  // Hide context menu on click outside
  document.addEventListener("click", () => {
    messageContextMenu.classList.add("hidden")
  })

  // Prevent default context menu
  document.addEventListener("contextmenu", (e) => {
    const messageElement = e.target.closest(".message")
    if (messageElement) {
      e.preventDefault()
      showContextMenu(e, messageElement)
    }
  })

  // Context menu actions
  document.getElementById("context-delete-for-me").addEventListener("click", () => {
    if (contextMenuTarget) {
      deleteMessage(contextMenuTarget.dataset.id, false)
    }
  })

  document.getElementById("context-delete-for-all").addEventListener("click", () => {
    if (contextMenuTarget) {
      deleteMessage(contextMenuTarget.dataset.id, true)
    }
  })

  document.getElementById("context-view-profile").addEventListener("click", () => {
    if (contextMenuTarget) {
      const walletAddress = contextMenuTarget.dataset.wallet
      viewUserProfile(walletAddress)
    }
  })
}

// Show context menu
function showContextMenu(e, messageElement) {
  const messageWallet = messageElement.dataset.wallet
  const isOwnMessage = messageWallet === currentAccount

  // Only show delete for all option for own messages
  document.getElementById("context-delete-for-all").style.display = isOwnMessage ? "block" : "none"
  // Only show delete for me option for own messages or if not deleted
  document.getElementById("context-delete-for-me").style.display =
    isOwnMessage && !messageElement.classList.contains("deleted") ? "block" : "none"
    
  // Show/hide block option
  const blockOption = document.getElementById("context-block-user")
  if (blockOption) {
    blockOption.style.display = messageWallet !== currentAccount ? "block" : "none"
    blockOption.textContent = isUserBlocked(messageWallet) ? "Unblock user" : "Block user"
  }
  
  // Show/hide delete room option
  const deleteRoomOption = document.getElementById("context-delete-room")
  if (deleteRoomOption) {
    deleteRoomOption.style.display = !isChatPrivate ? "block" : "none"
  }

  // Set position
  messageContextMenu.style.top = `${e.pageY}px`
  messageContextMenu.style.left = `${e.pageX}px`

  // Show menu
  messageContextMenu.classList.remove("hidden")

  // Set target
  contextMenuTarget = messageElement
}

// Delete message
async function deleteMessage(messageId, deleteForAll) {
  try {
    if (!currentAccount) return

    const response = await fetch(
      `/api/messages/${messageId}?walletAddress=${currentAccount}&deleteForAll=${deleteForAll}`,
      {
        method: "DELETE",
      },
    )

    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`)
    }

    const data = await response.json()
    console.log("Message deleted:", data)

    // The UI update will be handled by the WebSocket event
  } catch (error) {
    console.error("Error deleting message:", error)
    showNotification("Failed to delete message", "error")
  }
}

// Handle file select
function handleFileSelect(e) {
  const file = e.target.files[0]
  if (!file) return

  // Check file size (max 16MB)
  if (file.size > 16 * 1024 * 1024) {
    showNotification("File size exceeds 16MB limit", "error")
    return
  }

  selectedFile = file

  // Show file preview
  fileName.textContent = file.name
  fileSize.textContent = formatFileSize(file.size)
  filePreview.classList.remove("hidden")
}

// Format file size
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B"
  else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB"
  else return (bytes / 1048576).toFixed(1) + " MB"
}

// Clear file selection
function clearFileSelection() {
  selectedFile = null
  fileUpload.value = ""
  filePreview.classList.add("hidden")
}

// Upload file
async function uploadFile() {
  if (!selectedFile || !currentAccount) return null

  try {
    console.log("Uploading file:", selectedFile.name)
    const formData = new FormData()
    formData.append("file", selectedFile)
    formData.append("walletAddress", currentAccount)

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    })

    if (!response.ok) {
      const errorData = await response.text()
      console.error(`Server responded with status: ${response.status}`, errorData)
      throw new Error(`Server responded with status: ${response.status}`)
    }

    const data = await response.json()
    console.log("File uploaded successfully:", data)

    // Clear file selection
    clearFileSelection()

    return data
  } catch (error) {
    console.error("Error uploading file:", error)
    showNotification("Failed to upload file: " + error.message, "error")
    return null
  }
}

// Load theme preference
function loadThemePreference() {
  const savedTheme = localStorage.getItem("theme")
  if (savedTheme === "dark") {
    document.body.classList.remove("theme-light")
    document.body.classList.add("theme-dark")
  } else {
    document.body.classList.remove("theme-dark")
    document.body.classList.add("theme-light")
  }
}

// Toggle theme
function toggleTheme() {
  if (document.body.classList.contains("theme-light")) {
    document.body.classList.remove("theme-light")
    document.body.classList.add("theme-dark")
    localStorage.setItem("theme", "dark")
  } else {
    document.body.classList.remove("theme-dark")
    document.body.classList.add("theme-light")
    localStorage.setItem("theme", "light")
  }
}

// Toggle mobile menu
function toggleMobileMenu() {
  sidebar.classList.toggle("active")
}

// Connect wallet
async function connectWallet() {
  try {
    console.log("Attempting to connect wallet...")
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" })
    console.log("Accounts received:", accounts)
    handleAccountsChanged(accounts)

    // Check if we're on Polygon network
    const chainId = await window.ethereum.request({ method: "eth_chainId" })
    console.log("Current chain ID:", chainId)

    // Update the POLYGON_CHAIN_ID to match both hex and decimal formats
    if (chainId !== POLYGON_CHAIN_ID && chainId !== "137" && chainId !== 137) {
      showNotification("Please switch to Polygon Mainnet!", "warning")
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: POLYGON_CHAIN_ID }],
        })
      } catch (switchError) {
        console.error("Error switching chain:", switchError)
        // This error code indicates that the chain has not been added to MetaMask
        if (switchError.code === 4902) {
          try {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: POLYGON_CHAIN_ID,
                  chainName: "Polygon Mainnet",
                  nativeCurrency: {
                    name: "MATIC",
                    symbol: "MATIC",
                    decimals: 18,
                  },
                  rpcUrls: ["https://polygon-rpc.com/"],
                  blockExplorerUrls: ["https://polygonscan.com/"],
                },
              ],
            })
          } catch (addError) {
            console.error("Error adding Polygon network:", addError)
            showNotification("Failed to add Polygon network", "error")
          }
        }
      }
    }
  } catch (error) {
    console.error("Error connecting wallet:", error)
    showNotification("Failed to connect wallet: " + error.message, "error")
  }
}

// Disconnect wallet (for UI purposes only, MetaMask doesn't actually support disconnecting)
function disconnectWallet() {
  currentAccount = null
  userProfile = null
  
  // Clear localStorage
  localStorage.removeItem('currentWallet')
  localStorage.removeItem('userProfile')
  
  updateWalletUI()
  showNotification("Wallet disconnected", "success")
}

function showProfileModal() {
  if (!currentAccount) return

  // Fill current data
  displayNameInput.value = userProfile?.displayName || ""
  bioInput.value = userProfile?.bio || ""

  // Show modal
  profileModal.classList.remove("hidden")
}

// Handle accounts changed
function handleAccountsChanged(accounts) {
  console.log("Accounts changed:", accounts)
  if (accounts.length === 0) {
    // User disconnected their wallet
    currentAccount = null
    userProfile = null
    
    // Clear localStorage
    localStorage.removeItem('currentWallet')
    localStorage.removeItem('userProfile')
    
    showNotification("Wallet disconnected", "info")

    // Disable search input
    if (searchUserInput) {
      searchUserInput.disabled = true
      document.getElementById("search-button").disabled = true
    }
  } else if (accounts[0] !== currentAccount) {
    currentAccount = accounts[0]
    console.log("Connected account:", currentAccount)
    showNotification("Wallet connected: " + currentAccount.substring(0, 6) + "...", "success")
    
    // Save wallet to localStorage for persistence
    localStorage.setItem('currentWallet', currentAccount)

    // Enable search input
    if (searchUserInput) {
      searchUserInput.disabled = false
      document.getElementById("search-button").disabled = false
    }

    // Load user profile
    loadUserProfile()
    // Update user presence
    updateUserPresence()
    // Load friends and requests
    loadFriends()
    loadFriendRequests()
    loadPrivateChats()
    loadBlockedUsers()
    loadHiddenRooms()

    // Join user's personal room for notifications
    if (socket && socket.connected) {
      socket.emit("join", {
        type: "user",
        roomId: currentAccount,
      })
    }
  }

  updateWalletUI()
}

// Load user profile
async function loadUserProfile() {
  try {
    if (!currentAccount) return
    
    // Check localStorage first for faster loading
    const savedProfile = localStorage.getItem('userProfile')
    if (savedProfile) {
      userProfile = JSON.parse(savedProfile)
      // Still fetch from server to ensure data is up to date
    }
    
    const response = await fetch(`/api/profile?walletAddress=${currentAccount}`)
    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`)
    }
    
    const profile = await response.json()
    userProfile = profile
    
    // Save to localStorage for persistence
    localStorage.setItem('userProfile', JSON.stringify(profile))
    
    return profile
  } catch (error) {
    console.error("Error loading user profile:", error)
    return null
  }
}

// View user profile
async function viewUserProfile(walletAddress) {
  try {
    const response = await fetch(`/api/profile?walletAddress=${walletAddress}`)
    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`)
    }

    const profile = await response.json()
    console.log("User profile:", profile)

    // Update UI with profile data
    document.getElementById("user-profile-avatar").src = profile.avatar
    document.getElementById("user-profile-name").textContent = profile.displayName
    document.getElementById("user-profile-wallet").textContent =
      `${walletAddress.substring(0, 6)}...${walletAddress.substring(38)}`
    document.getElementById("user-profile-bio").textContent = profile.bio || "No bio provided"

    // Add friend button if not already friends
    const isFriend = friends.some((friend) => friend.walletAddress === walletAddress)
    const isCurrentUser = walletAddress === currentAccount
    const isBlocked = isUserBlocked(walletAddress)

    const actionContainer = document.querySelector(".user-profile-actions")
    if (actionContainer) {
      actionContainer.innerHTML = ""

      if (!isCurrentUser) {
        if (isFriend) {
          // Find private room ID
          const friend = friends.find((f) => f.walletAddress === walletAddress)
          if (friend && friend.privateRoomId) {
            const chatButton = document.createElement("button")
            chatButton.classList.add("chat-with-user-button")
            chatButton.textContent = "Chat"
            chatButton.addEventListener("click", () => {
              openPrivateChat(friend.privateRoomId, walletAddress, profile.displayName)
              document.getElementById("user-profile-modal").classList.add("hidden")
            })
            actionContainer.appendChild(chatButton)
          }
          
          // Add block button
          const blockButton = document.createElement("button")
          blockButton.classList.add("block-user-button")
          blockButton.textContent = isBlocked ? "Unblock" : "Block"
          blockButton.addEventListener("click", () => {
            if (isBlocked) {
              unblockUser(walletAddress)
            } else {
              blockUser(walletAddress)
            }
            document.getElementById("user-profile-modal").classList.add("hidden")
          })
          actionContainer.appendChild(blockButton)
        } else {
          // Add friend button
          const addButton = document.createElement("button")
          addButton.classList.add("add-friend-button")
          addButton.textContent = "Add Friend"
          addButton.addEventListener("click", () => {
            sendFriendRequest(walletAddress)
            addButton.textContent = "Request Sent"
            addButton.disabled = true
          })
          actionContainer.appendChild(addButton)
          
          // Add block button
          const blockButton = document.createElement("button")
          blockButton.classList.add("block-user-button")
          blockButton.textContent = isBlocked ? "Unblock" : "Block"
          blockButton.addEventListener("click", () => {
            if (isBlocked) {
              unblockUser(walletAddress)
            } else {
              blockUser(walletAddress)
            }
            document.getElementById("user-profile-modal").classList.add("hidden")
          })
          actionContainer.appendChild(blockButton)
        }
      }
    }

    // Show modal
    document.getElementById("user-profile-modal").classList.remove("hidden")
  } catch (error) {
    console.error("Error loading user profile:", error)
    showNotification("Failed to load user profile", "error")
  }
}

// Handle chain changed
function handleChainChanged(chainId) {
  isPolygonNetwork = chainId === POLYGON_CHAIN_ID
  updateNetworkUI()
  // Reload the page to avoid any issues
  window.location.reload()
}

// Update wallet UI
function updateWalletUI() {
  if (currentAccount) {
    console.log("Wallet connected:", currentAccount)
    connectWalletButton.classList.add("hidden")
    walletInfo.classList.remove("hidden")
    walletAddressElement.textContent = `${currentAccount.substring(0, 6)}...${currentAccount.substring(38)}`

    // Set user avatar and display name
    if (userProfile) {
      userAvatarElement.src = userProfile.avatar
      displayNameElement.textContent = userProfile.displayName
    } else {
      userAvatarElement.src = `https://api.dicebear.com/9.x/pixel-art/svg?seed=${currentAccount}&hair=short01,short02,short03,short04,short05`
      displayNameElement.textContent = `User ${currentAccount.substring(0, 6)}`
    }

    // Enable message input and send button
    messageInput.disabled = false
    sendButton.disabled = false
    emojiButton.disabled = false
    fileButton.disabled = false

    // Remove welcome message if it exists
    const welcomeMessage = document.querySelector(".welcome-message")
    if (welcomeMessage) {
      welcomeMessage.remove()
    }
  } else {
    console.log("Wallet not connected")
    connectWalletButton.classList.remove("hidden")
    walletInfo.classList.add("hidden")
    messageInput.disabled = true
    sendButton.disabled = true
    emojiButton.disabled = true
    fileButton.disabled = true
  }
}

// Update network UI
function updateNetworkUI() {
  if (isPolygonNetwork) {
    connectionStatus.classList.remove("offline")
    connectionStatus.classList.add("online")
    statusText.textContent = "Connected to Polygon"
  } else {
    connectionStatus.classList.remove("online")
    connectionStatus.classList.add("offline")
    statusText.textContent = "Not connected to Polygon"
  }
}

// Poll network status
async function pollNetworkStatus() {
  try {
    const response = await fetch("/api/network-status")
    const data = await response.json()

    if (data.connected) {
      connectionStatus.classList.remove("offline")
      connectionStatus.classList.add("online")
      statusText.textContent = "Connected to Polygon"

      chainIdElement.textContent = data.chainId
      latestBlockElement.textContent = data.latestBlock

      // Convert gas price from wei to gwei
      const gasPriceGwei = web3
        ? web3.utils.fromWei(data.gasPrice, "gwei")
        : (Number.parseInt(data.gasPrice) / 1e9).toFixed(2)
      gasPriceElement.textContent = `${gasPriceGwei} Gwei`
    } else {
      connectionStatus.classList.remove("online")
      connectionStatus.classList.add("offline")
      statusText.textContent = "Server disconnected"
    }
  } catch (error) {
    console.error("Error polling network status:", error)
    connectionStatus.classList.remove("online")
    connectionStatus.classList.add("offline")
    statusText.textContent = "Connection error"
  }

  // Poll every 30 seconds
  setTimeout(pollNetworkStatus, 30000)
}

// Load rooms
async function loadRooms() {
  try {
    // Include wallet address to filter out hidden rooms
    const url = currentAccount ? `/api/rooms?walletAddress=${currentAccount}` : "/api/rooms"
    const response = await fetch(url)
    rooms = await response.json()

    // Clear rooms list
    roomsList.innerHTML = ""

    // Add rooms to the list
    Object.keys(rooms).forEach((roomId) => {
      const room = rooms[roomId]
      const roomElement = document.createElement("li")
      roomElement.classList.add("room")
      if (roomId === currentRoom && !isChatPrivate) {
        roomElement.classList.add("active")
      }
      roomElement.dataset.room = roomId
      roomElement.innerHTML = `
                <span class="room-icon">#</span>
                <span class="room-name">${room.name}</span>
            `
      roomElement.addEventListener("click", () => {
        switchRoom(roomId)
      })
      roomsList.appendChild(roomElement)
    })

    // Update current room name and description
    if (!isChatPrivate && rooms[currentRoom]) {
      currentRoomName.textContent = rooms[currentRoom].name
      roomDescription.textContent = rooms[currentRoom].description
    }
    
    // Load hidden rooms
    if (currentAccount) {
      loadHiddenRooms()
    }
  } catch (error) {
    console.error("Error loading rooms:", error)
    showNotification("Failed to load chat rooms", "error")
  }
}

// Switch room
function switchRoom(roomId) {
  if (roomId === currentRoom && !isChatPrivate) return

  // Leave current room
  if (isChatPrivate) {
    socket.emit("leave", {
      type: "private",
      roomId: currentPrivateRoom,
    })
    isChatPrivate = false
    currentPrivateRoom = null
  } else {
    socket.emit("leave", {
      type: "public",
      roomId: currentRoom,
    })
  }

  // Update active room in UI
  const roomElements = document.querySelectorAll(".room")
  roomElements.forEach((el) => {
    if (el.dataset.room === roomId) {
      el.classList.add("active")
    } else {
      el.classList.remove("active")
    }
  })

  const privateChatElements = document.querySelectorAll(".private-chat-item")
  privateChatElements.forEach((el) => {
    el.classList.remove("active")
  })

  // Update current room
  currentRoom = roomId

  // Join new room
  socket.emit("join", {
    type: "public",
    roomId: currentRoom,
  })

  // Update current room name and description
  if (rooms[currentRoom]) {
    currentRoomName.textContent = rooms[currentRoom].name
    roomDescription.textContent = rooms[currentRoom].description
  }

  // Load messages for the new room
  loadMessages()

  // Close mobile menu if open
  if (sidebar.classList.contains("active")) {
    sidebar.classList.remove("active")
  }
}

// Poll active users
async function pollActiveUsers() {
  try {
    const response = await fetch("/api/users/active")
    activeUsers = await response.json()

    updateActiveUsersList()
  } catch (error) {
    console.error("Error polling active users:", error)
  }

  // Poll every 10 seconds
  setTimeout(pollActiveUsers, 10000)
}

// Update active users list
function updateActiveUsersList() {
  // Clear active users list
  activeUsersList.innerHTML = ""

  // Add active users to the list
  Object.keys(activeUsers).forEach((userId) => {
    // Skip blocked users
    if (isUserBlocked(userId)) return
    
    const user = activeUsers[userId]
    const userElement = document.createElement("li")
    userElement.classList.add("active-user")
    userElement.dataset.userId = userId
    userElement.innerHTML = `
            <div class="user-status"></div>
            <div class="user-avatar">
              <img src="${user.avatar}" alt="User avatar">
            </div>
            <span>${user.displayName}</span>
        `
    userElement.addEventListener("click", () => {
      viewUserProfile(userId)
    })
    activeUsersList.appendChild(userElement)
  })
}

// Update user presence
async function updateUserPresence() {
  if (!currentAccount) return

  try {
    await fetch("/api/user/presence", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        walletAddress: currentAccount,
        name: userProfile ? userProfile.displayName : `User ${currentAccount.substring(0, 6)}`,
      }),
    })
  } catch (error) {
    console.error("Error updating user presence:", error)
  }
}

// Load messages
async function loadMessages() {
  try {
    let url
    if (isChatPrivate) {
      url = `/api/messages?privateRoom=${currentPrivateRoom}`
    } else {
      url = `/api/messages?room=${currentRoom}`
    }

    const response = await fetch(url)
    const messages = await response.json()

    // Clear messages container
    messagesContainer.innerHTML = ""

    // If no messages and no wallet connected, show welcome message
    if (messages.length === 0 && !currentAccount) {
      const welcomeMessage = document.createElement("div")
      welcomeMessage.classList.add("welcome-message")
      welcomeMessage.innerHTML = `
                <div class="welcome-header">
                    <svg width="64" height="64" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                          viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M40 80C62.0914 80 80 62.0914 80 40C80 17.9086 62.0914 0 40 0C17.9086 0 0 17.9086 0 40C0 62.0914 17.9086 80 40 80Z" fill="#8247E5"/>
                        <path d="M53.7022 40.0001L41.1796 52.5227L28.6571 40.0001L41.1796 27.4775L53.7022 40.0001Z" fill="white"/>
                        <path d="M41.1796 19.7549L25.2959 35.6386L41.1796 51.5223L57.0633 35.6386L41.1796 19.7549Z" fill="white"/>
                        <path d="M25.2959 44.3615L41.1796 60.2452L57.0633 44.3615L41.1796 28.4778L25.2959 44.3615Z" fill="white"/>
                    </svg>
                    <h2>Welcome to PolyChat</h2>
                </div>
                <p>Connect your wallet to start chatting on the Polygon network</p>
                <div class="welcome-features">
                    <div class="feature">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <div>
                            <h3>Multiple Chat Rooms</h3>
                            <p>Join different rooms for various topics</p>
                        </div>
                    </div>
                    <div class="feature">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="2" y1="12" x2="22" y2="12"></line>
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                        </svg>
                        <div>
                            <h3>Polygon Network</h3>
                            <p>Built on Polygon for fast, low-cost transactions</p>
                        </div>
                    </div>
                    <div class="feature">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        <div>
                            <h3>Wallet Authentication</h3>
                            <p>Secure login with your crypto wallet</p>
                        </div>
                    </div>
                </div>
            `
      messagesContainer.appendChild(welcomeMessage)
    } else if (messages.length === 0) {
      // Show empty state for chat
      const emptyState = document.createElement("div")
      emptyState.classList.add("empty-chat-state")

      if (isChatPrivate) {
        emptyState.innerHTML = `
                    <div class="empty-state-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                    </div>
                    <h3>No messages yet</h3>
                    <p>Start a conversation with your friend</p>
                `
      } else {
        emptyState.innerHTML = `
                    <div class="empty-state-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                    </div>
                    <h3>No messages in this room</h3>
                    <p>Be the first to start a conversation</p>
                `
      }

      messagesContainer.appendChild(emptyState)
    } else {
      // Add messages
      messages.forEach((message) => {
        // Skip messages from blocked users
        if (!isUserBlocked(message.walletAddress)) {
          addMessageToUI(message)
        }
      })
    }

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  } catch (error) {
    console.error("Error loading messages:", error)
    showNotification("Failed to load messages", "error")
  }
}

// Send message
async function sendMessage() {
  const content = messageInput.value.trim()
  if ((!content && !selectedFile) || !currentAccount) {
    console.log("Cannot send: content empty or no wallet connected")
    return
  }

  try {
    console.log("Sending message with content:", content)

    let fileData = null
    let fileType = null
    if (selectedFile) {
      fileType = selectedFile.type
      fileData = await uploadFile()
      if (!fileData) {
        return
      }
    }

    // Prepare message data
    const messageData = {
      content: content,
      walletAddress: currentAccount,
    }

    // Add file data if exists
    if (fileData) {
      messageData.type = fileType.startsWith("image/") ? "image" : "file"
      messageData.fileUrl = fileData.fileUrl
      messageData.fileName = fileData.fileName
    }

    // Set room or private room
    if (isChatPrivate) {
      messageData.privateRoomId = currentPrivateRoom
    } else {
      messageData.room = currentRoom
    }

    console.log("Sending message data:", messageData)

    const response = await fetch("/api/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messageData),
    })

    if (!response.ok) {
      const errorData = await response.text()
      console.error(`Server responded with status: ${response.status}`, errorData)
      throw new Error(`Server responded with status: ${response.status}`)
    }

    const message = await response.json()
    console.log("Message sent successfully:", message)

    // Add message to UI immediately for better user experience
    addMessageToUI(message)

    // Clear input field
    messageInput.value = ""

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight
  } catch (error) {
    console.error("Error sending message:", error)
    showNotification("Failed to send message: " + error.message, "error")
  }
}

// Add message to UI
function addMessageToUI(message) {
  // تحقق إذا كانت الرسالة موجودة بالفعل لتفادي التكرار
  if (document.querySelector(`.message[data-id="${message.id}"]`)) {
    return;
  }

  const messageElement = document.createElement("div");
  messageElement.classList.add("message");
  messageElement.dataset.id = message.id;
  messageElement.dataset.wallet = message.walletAddress;

  // التحقق إذا كانت الرسالة من المستخدم الحالي
  const isCurrentUser = message.walletAddress === currentAccount;
  messageElement.classList.add(isCurrentUser ? "user-message" : "other-message");

  // تنسيق الوقت
  const date = new Date(message.timestamp * 1000);
  const timeString = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // إنشاء رأس الرسالة
  const messageHeader = document.createElement("div");
  messageHeader.classList.add("message-header");
  messageHeader.innerHTML = `
        <div class="message-avatar">
            <img src="${message.avatar}" alt="User avatar">
        </div>
        <span class="message-sender">${message.displayName}</span>
        <span class="message-timestamp">${timeString}</span>
    `;

  // إضافة مستمعي الأحداث لعرض ملف التعريف عند النقر على الصورة أو الاسم
  const avatarElement = messageHeader.querySelector(".message-avatar");
  const senderElement = messageHeader.querySelector(".message-sender");

  avatarElement.addEventListener("click", () => {
    viewUserProfile(message.walletAddress);
  });

  senderElement.addEventListener("click", () => {
    viewUserProfile(message.walletAddress);
  });

  messageElement.appendChild(messageHeader);

  // إنشاء محتوى الرسالة بناءً على النوع
  if (message.type === "image") {
    const contentElement = document.createElement("div");
    contentElement.classList.add("message-content");
    contentElement.textContent = message.content;
    messageElement.appendChild(contentElement);

    const imageElement = document.createElement("img");
    imageElement.classList.add("message-image");
    imageElement.src = message.fileUrl;
    imageElement.alt = "Shared image";
    imageElement.addEventListener("click", () => {
      window.open(message.fileUrl, "_blank");
    });
    messageElement.appendChild(imageElement);
  } else if (message.type === "file") {
    const contentElement = document.createElement("div");
    contentElement.classList.add("message-content");
    contentElement.textContent = message.content;
    messageElement.appendChild(contentElement);

    const fileElement = document.createElement("div");
    fileElement.classList.add("message-file");
    fileElement.innerHTML = `
            <div class="file-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                    <polyline points="13 2 13 9 20 9"></polyline>
                </svg>
            </div>
            <div class="file-info">
                <span class="file-name">${message.fileName}</span>
                <span class="file-size">Click to download</span>
            </div>
            <div class="file-download">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
            </div>
        `;
    fileElement.addEventListener("click", () => {
      window.open(message.fileUrl, "_blank");
    });
    messageElement.appendChild(fileElement);
  } else {
    const contentElement = document.createElement("div");
    contentElement.classList.add("message-content");
    contentElement.textContent = message.content;
    messageElement.appendChild(contentElement);
  }

  // إنشاء ذيل الرسالة مع عرض عنوان المحفظة بشكل مختصر
  const messageFooter = document.createElement("div");
  messageFooter.classList.add("message-footer");
  messageFooter.innerHTML = `
        <span class="wallet-address-tag">${message.walletAddress.substring(0, 6)}...${message.walletAddress.substring(38)}</span>
    `;
  messageElement.appendChild(messageFooter);

  messagesContainer.appendChild(messageElement);
}

// Toggle emoji picker
function toggleEmojiPicker() {
  if (!isEmojiPickerOpen) {
    emojiPicker.classList.remove("hidden")
    isEmojiPickerOpen = true
  } else {
    emojiPicker.classList.add("hidden")
    isEmojiPickerOpen = false
  }
}

// Handle avatar selection
function handleAvatarSelect(e) {
  const file = e.target.files[0]
  if (!file) return

  // Validate image type and size (max 2MB)
  if (!file.type.startsWith("image/")) {
    showNotification("Please select an image file", "error")
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    showNotification("Image size should be less than 2MB", "error")
    return
  }

  avatarFile = file

  // Show preview
  const reader = new FileReader()
  reader.onload = (e) => {
    profileAvatarPreview.src = e.target.result
  }
  reader.readAsDataURL(file)
}

// Save profile
async function saveProfile() {
  if (!currentAccount) {
    showNotification("Please connect your wallet first", "warning")
    return
  }

  try {
    saveProfileButton.textContent = "Saving..."
    saveProfileButton.disabled = true

    // Upload new avatar if selected
    let avatarUrl = userProfile?.avatar
    if (avatarFile) {
      const formData = new FormData()
      formData.append("avatar", avatarFile)
      formData.append("walletAddress", currentAccount)

      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()
      avatarUrl = data.avatar
    }

    // Prepare profile data
    const profileData = {
      displayName: displayNameInput.value.trim() || `User ${currentAccount.substring(0, 6)}`,
      bio: bioInput.value.trim(),
      avatar: avatarUrl,
      walletAddress: currentAccount,
    }

    // Update profile
    const response = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profileData),
    })

    const updatedProfile = await response.json()

    // Update local profile and UI
    userProfile = updatedProfile
    displayNameElement.textContent = userProfile.displayName
    userAvatarElement.src = userProfile.avatar
    
    // Save to localStorage for persistence
    localStorage.setItem('userProfile', JSON.stringify(updatedProfile))

    // Close modal and reset
    profileModal.classList.add("hidden")
    avatarFile = null
    showNotification("Profile updated successfully", "success")
  } catch (error) {
    console.error("Error saving profile:", error)
    showNotification("Failed to update profile", "error")
  } finally {
    saveProfileButton.textContent = "Save Profile"
    saveProfileButton.disabled = false
  }
}

// Show notification
function showNotification(message, type = "info") {
  const notificationContainer = document.getElementById("notification-container")
  const notification = document.createElement("div")
  notification.classList.add("notification")
  notification.classList.add(type)
  notification.textContent = message

  notificationContainer.appendChild(notification)

  // Remove notification after 3 seconds
  setTimeout(() => {
    notification.remove()
  }, 3000)
}

// Add this function to check if MetaMask is installed and properly initialized
function checkMetaMaskInstallation() {
  if (typeof window.ethereum !== "undefined") {
    console.log("MetaMask is installed!")
    return true
  } else {
    console.error("MetaMask is not installed!")
    showNotification("Please install MetaMask to use this application", "error")
    statusText.textContent = "MetaMask not detected"
    return false
  }
}

// Delete room
async function deleteRoom(roomId) {
  try {
    if (!currentAccount) return
    
    const response = await fetch(`/api/rooms/${roomId}?walletAddress=${currentAccount}`, {
      method: "DELETE"
    })
    
    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`)
    }
    
    const data = await response.json()
    console.log("Room deleted:", data)
    
    // If current room was deleted, switch to General
    if (currentRoom === roomId) {
      switchRoom("General")
    }
    
    // Reload rooms
    loadRooms()
    
    showNotification(`Room deleted`, "success")
  } catch (error) {
    console.error("Error deleting room:", error)
    showNotification("Failed to delete room", "error")
  }
}

// Initialize the app when the DOM is loaded
document.addEventListener("DOMContentLoaded", initApp)

console.log("PolyChat App JavaScript loaded with friend system, private chat, and block functionality")
