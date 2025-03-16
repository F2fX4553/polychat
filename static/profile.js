// DOM Elements for Profile Management
const editProfileButton = document.getElementById('edit-profile');
const profileModal = document.getElementById('profile-modal');
const closeProfileModal = document.getElementById('close-profile-modal');
const changeAvatarButton = document.getElementById('change-avatar');
const avatarUpload = document.getElementById('avatar-upload');
const profileAvatarPreview = document.getElementById('profile-avatar-preview');
const displayNameInput = document.getElementById('display-name-input');
const bioInput = document.getElementById('bio-input');
const saveProfileButton = document.getElementById('save-profile');

// DOM Elements for User Profile Viewing
const userProfileModal = document.getElementById('user-profile-modal');
const closeUserProfileModal = document.getElementById('close-user-profile-modal');

// Variables
let avatarFile = null;
//let currentAccount = null; // Declare currentAccount
//let userProfile = null; // Declare userProfile
//let showNotification = (message, type) => { console.log(`${type}: ${message}`); }; // Declare showNotification
let displayNameElement = document.getElementById('display-name'); // Assuming there's an element with id 'display-name'
let userAvatarElement = document.getElementById('user-avatar'); // Assuming there's an element with id 'user-avatar'

// Initialize profile functionality
function initProfileFunctionality() {
    // Setup event listeners
    editProfileButton.addEventListener('click', openProfileModal);
    closeProfileModal.addEventListener('click', closeModal);
    changeAvatarButton.addEventListener('click', () => avatarUpload.click());
    avatarUpload.addEventListener('change', handleAvatarSelect);
    saveProfileButton.addEventListener('click', saveProfile);
    closeUserProfileModal.addEventListener('click', () => userProfileModal.classList.add('hidden'));
    
    // Close modals when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === profileModal) {
            closeModal();
        }
        if (e.target === userProfileModal) {
            userProfileModal.classList.add('hidden');
        }
    });
}

// Open profile modal
function openProfileModal() {
    if (!currentAccount || !userProfile) {
        showNotification('Please connect your wallet first', 'warning');
        return;
    }
    
    // Populate form with current profile data
    profileAvatarPreview.src = userProfile.avatar;
    displayNameInput.value = userProfile.displayName || '';
    bioInput.value = userProfile.bio || '';
    
    // Reset avatar file
    avatarFile = null;
    
    // Show modal
    profileModal.classList.remove('hidden');
}

// Close modal
function closeModal() {
    profileModal.classList.add('hidden');
}

// Handle avatar select
function handleAvatarSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Check file type
    if (!file.type.match('image.*')) {
        showNotification('Please select an image file', 'error');
        return;
    }
    
    // Check file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
        showNotification('Image size should be less than 2MB', 'error');
        return;
    }
    
    avatarFile = file;
    
    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
        profileAvatarPreview.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// Save profile
async function saveProfile() {
    if (!currentAccount) {
        showNotification('Please connect your wallet first', 'warning');
        return;
    }
    
    try {
        // Show loading state
        saveProfileButton.textContent = 'Saving...';
        saveProfileButton.disabled = true;
        
        // Upload avatar if selected
        let avatarUrl = userProfile?.avatar;
        if (avatarFile) {
            const formData = new FormData();
            formData.append('avatar', avatarFile);
            formData.append('walletAddress', currentAccount);
            
            const response = await fetch('/api/profile/avatar', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }
            
            const data = await response.json();
            avatarUrl = data.avatar;
        }
        
        // Update profile data
        const profileData = {
            walletAddress: currentAccount,
            displayName: displayNameInput.value.trim() || `User ${currentAccount.substring(0, 6)}`,
            bio: bioInput.value.trim(),
            avatar: avatarUrl
        };
        
        const response = await fetch('/api/profile', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(profileData)
        });
        
        if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
        }
        
        const updatedProfile = await response.json();
        
        // Update local profile
        userProfile = updatedProfile;
        
        // Update UI
        displayNameElement.textContent = userProfile.displayName;
        userAvatarElement.src = userProfile.avatar;
        
        // Close modal
        closeModal();
        
        showNotification('Profile updated successfully', 'success');
    } catch (error) {
        console.error('Error saving profile:', error);
        showNotification('Failed to update profile', 'error');
    } finally {
        // Reset button state
        saveProfileButton.textContent = 'Save Profile';
        saveProfileButton.disabled = false;
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initProfileFunctionality);

console.log("Profile management JavaScript loaded");