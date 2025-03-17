from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import Column, Integer, String, Text, Boolean, ForeignKey, DateTime, Table, func
from sqlalchemy.orm import relationship
import json
import os
import socket
import uuid
import time
import threading
from datetime import datetime, timedelta
from werkzeug.utils import secure_filename
from flask import render_template


# Try to import Web3, use mock data if not available
try:
    from web3 import Web3
    from web3.middleware import geth_poa_middleware
    web3_available = True
except ImportError:
    web3_available = False
    print("Web3 not installed. Network status features will be limited.")

app = Flask(__name__, static_folder='static')
CORS(app)

# SQLAlchemy Configuration
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///polychat.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# SocketIO Configuration
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# Environment variables
INFURA_ID = os.environ.get('INFURA_ID', 'b99b1b2b1ead4bf2bd7b89556e7575f8')
POLYGON_API_KEY = os.environ.get('POLYGON_API_KEY', 'AVQUKG6XPRQMJSE2A2C283FNECZQZJPSHW')

# Connect to Polygon Mainnet
w3 = None
if web3_available:
    try:
        if INFURA_ID:
            polygon_rpc_url = f"https://polygon-mainnet.infura.io/v3/{INFURA_ID}"
            print("Using Infura endpoint for Polygon")
        else:
            polygon_rpc_url = "https://polygon-rpc.com"
            print("INFURA_ID not set. Using public RPC endpoint for Polygon")
        
        w3 = Web3(Web3.HTTPProvider(polygon_rpc_url))
        # Add PoA middleware for Polygon
        w3.middleware_onion.inject(geth_poa_middleware, layer=0)
        
        if w3.is_connected():
            print("Connected to Polygon: True")
        else:
            print("Connected to Polygon: False - Using public RPC endpoint")
    except Exception as e:
        print(f"Error connecting to Polygon: {str(e)}")
        w3 = None
else:
    print("Web3 library not available. Using mock network data.")

# Setup upload folder
UPLOAD_FOLDER = os.path.join(app.static_folder, 'uploads')
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max

# Allowed file extensions
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt','js','py','html','css','mp3','mp4'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# SQLAlchemy Models
# Friends relationship table
friends = Table(
    'friends',
    db.Model.metadata,
    Column('user_id', String(42), ForeignKey('users.wallet_address'), primary_key=True),
    Column('friend_id', String(42), ForeignKey('users.wallet_address'), primary_key=True),
    Column('created_at', DateTime, default=func.now())
)

# Friend requests table
friend_requests = Table(
    'friend_requests',
    db.Model.metadata,
    Column('sender_id', String(42), ForeignKey('users.wallet_address'), primary_key=True),
    Column('receiver_id', String(42), ForeignKey('users.wallet_address'), primary_key=True),
    Column('created_at', DateTime, default=func.now()),
    Column('status', String(20), default='pending')  # pending, accepted, rejected
)

class User(db.Model):
    __tablename__ = 'users'
    
    wallet_address = Column(String(42), primary_key=True)
    display_name = Column(String(100))
    avatar = Column(String(255))
    bio = Column(Text)
    last_active = Column(DateTime, default=func.now())
    created_at = Column(DateTime, default=func.now())
    
    # Relationships
    sent_messages = relationship('Message', foreign_keys='Message.sender_id', backref='sender')
    received_messages = relationship('Message', foreign_keys='Message.receiver_id', backref='receiver')
    
    # Friends relationship
    friends_rel = relationship(
        'User', 
        secondary=friends,
        primaryjoin=(wallet_address == friends.c.user_id),
        secondaryjoin=(wallet_address == friends.c.friend_id),
        backref=db.backref('friended_by', lazy='dynamic')
    )
    
    # Friend requests relationship
    sent_requests = relationship(
        'User',
        secondary=friend_requests,
        primaryjoin=(wallet_address == friend_requests.c.sender_id),
        secondaryjoin=(wallet_address == friend_requests.c.receiver_id),
        backref=db.backref('received_requests', lazy='dynamic')
    )
    
    def __init__(self, wallet_address, display_name=None, avatar=None, bio=None):
        self.wallet_address = wallet_address
        self.display_name = display_name or f"User {wallet_address[:6]}"
        self.avatar = avatar or f"https://api.dicebear.com/9.x/pixel-art/svg?seed={wallet_address}&hair=short01,short02,short03,short04,short05"
        self.bio = bio or ""
    
    def to_dict(self):
        return {
            'walletAddress': self.wallet_address,
            'displayName': self.display_name,
            'avatar': self.avatar,
            'bio': self.bio,
            'lastActive': self.last_active.isoformat() if self.last_active else None,
            'createdAt': self.created_at.isoformat() if self.created_at else None
        }

class BlockedUser(db.Model):
    __tablename__ = 'blocked_users'
    id = Column(Integer, primary_key=True)
    blocker_id = Column(String(42), ForeignKey('users.wallet_address'))
    blocked_id = Column(String(42), ForeignKey('users.wallet_address'))
    created_at = Column(DateTime, default=func.now())

    def to_dict(self):
         return {
              "blockerId": self.blocker_id,
              "blockedId": self.blocked_id,
              "createdAt": self.created_at.isoformat() if self.created_at else None
         }


class ChatRoom(db.Model):
    __tablename__ = 'chat_rooms'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100))
    description = Column(Text)
    is_private = Column(Boolean, default=False)
    created_at = Column(DateTime, default=func.now())
    
    # Relationships
    messages = relationship('Message', backref='room')
    
    def __init__(self, name, description, is_private=False):
        self.id = str(uuid.uuid4())
        self.name = name
        self.description = description
        self.is_private = is_private
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'isPrivate': self.is_private,
            'createdAt': self.created_at.isoformat() if self.created_at else None
        }

class PrivateChatRoom(db.Model):
    __tablename__ = 'private_chat_rooms'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user1_id = Column(String(42), ForeignKey('users.wallet_address'))
    user2_id = Column(String(42), ForeignKey('users.wallet_address'))
    created_at = Column(DateTime, default=func.now())
    
    # Relationships
    user1 = relationship('User', foreign_keys=[user1_id])
    user2 = relationship('User', foreign_keys=[user2_id])
    messages = relationship('Message', backref='private_room')
    
    def __init__(self, user1_id, user2_id):
        self.id = str(uuid.uuid4())
        self.user1_id = user1_id
        self.user2_id = user2_id
    
    def to_dict(self):
        return {
            'id': self.id,
            'user1Id': self.user1_id,
            'user2Id': self.user2_id,
            'createdAt': self.created_at.isoformat() if self.created_at else None
        }

class Message(db.Model):
    __tablename__ = 'messages'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    content = Column(Text)
    sender_id = Column(String(42), ForeignKey('users.wallet_address'))
    receiver_id = Column(String(42), ForeignKey('users.wallet_address'), nullable=True)
    room_id = Column(String(36), ForeignKey('chat_rooms.id'), nullable=True)
    private_room_id = Column(String(36), ForeignKey('private_chat_rooms.id'), nullable=True)
    type = Column(String(20), default='text')  # text, image, file
    file_url = Column(String(255), nullable=True)
    file_name = Column(String(255), nullable=True)
    timestamp = Column(DateTime, default=func.now())
    is_deleted = Column(Boolean, default=False)
    
    def __init__(self, content, sender_id, type='text', file_url=None, file_name=None, receiver_id=None, room_id=None, private_room_id=None):
        self.id = str(uuid.uuid4())
        self.content = content
        self.sender_id = sender_id
        self.type = type
        self.file_url = file_url
        self.file_name = file_name
        self.receiver_id = receiver_id
        self.room_id = room_id
        self.private_room_id = private_room_id
    
    def to_dict(self):
        sender = User.query.get(self.sender_id)
        return {
            'id': self.id,
            'content': self.content,
            'sender': sender.display_name if sender else f"User {self.sender_id[:6]}",
            'senderId': self.sender_id,
            'receiverId': self.receiver_id,
            'roomId': self.room_id,
            'privateRoomId': self.private_room_id,
            'type': self.type,
            'fileUrl': self.file_url,
            'fileName': self.file_name,
            'timestamp': int(self.timestamp.timestamp()) if self.timestamp else int(time.time()),
            'isDeleted': self.is_deleted,
            'walletAddress': self.sender_id,
            'avatar': sender.avatar if sender else f"https://api.dicebear.com/9.x/pixel-art/svg?seed={self.sender_id}&hair=short01,short02,short03,short04,short05",
            'displayName': sender.display_name if sender else f"User {self.sender_id[:6]}"
        }

# Create database and default rooms
def create_tables():
    with app.app_context():
        db.create_all()
        
        # Add default rooms if they don't exist
        if ChatRoom.query.count() == 0:
            default_rooms = [
                ChatRoom("General", "Public chat for everyone"),
                ChatRoom("Developers", "Technical discussions about Polygon"),
                ChatRoom("Trading", "Price discussion and market analysis")
            ]
            db.session.add_all(default_rooms)
            db.session.commit()
            print("Default chat rooms created")

# Initialize the database when the app starts
create_tables()

@app.route('/api/users/block', methods=['POST'])
def block_user():
    data = request.json
    blocker_id = data.get('blockerId')
    blocked_id = data.get('blockedId')
    if not blocker_id or not blocked_id:
        return jsonify({"error": "blockerId and blockedId are required"}), 400
    existing = BlockedUser.query.filter_by(blocker_id=blocker_id, blocked_id=blocked_id).first()
    if existing:
        return jsonify({"message": "User already blocked"}), 200
    new_block = BlockedUser(blocker_id=blocker_id, blocked_id=blocked_id)
    db.session.add(new_block)
    db.session.commit()
    return jsonify(new_block.to_dict()), 200

@app.route('/api/users/unblock', methods=['POST'])
def unblock_user():
    data = request.json
    blocker_id = data.get('blockerId')
    blocked_id = data.get('blockedId')
    if not blocker_id or not blocked_id:
        return jsonify({"error": "blockerId and blockedId are required"}), 400
    block_entry = BlockedUser.query.filter_by(blocker_id=blocker_id, blocked_id=blocked_id).first()
    if block_entry:
        db.session.delete(block_entry)
        db.session.commit()
        return jsonify({"message": "User unblocked successfully"}), 200
    return jsonify({"error": "Block entry not found"}), 404

# Clean up inactive users
def cleanup_inactive_users():
    while True:
        try:
            with app.app_context():
                current_time = datetime.now()
                five_minutes_ago = current_time - timedelta(minutes=5)
                
                # Fixed query to avoid using timestamp() method
                inactive_users = User.query.filter(
                    User.last_active < five_minutes_ago
                ).all()
                
                for user in inactive_users:
                    print(f"Marking user as inactive: {user.wallet_address}")
                    socketio.emit('user_disconnected', {'userId': user.wallet_address})
        except Exception as e:
            print(f"Error in cleanup thread: {str(e)}")
        time.sleep(60)

# Start cleanup thread
cleanup_thread = threading.Thread(target=cleanup_inactive_users, daemon=True)
cleanup_thread.start()

# --------------------- REST API Endpoints ---------------------

@app.route('/')
def index():
    # Retrieve or define a user profile, even if it's empty
    user_profile = {}  # or your logic to get the profile
    return render_template('index.html', user_profile=user_profile)

@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

# Get messages (filtered by room or private chat)
@app.route('/api/messages', methods=['GET'])
def get_messages():
    room_id = request.args.get('room')
    private_room_id = request.args.get('privateRoom')
    limit = int(request.args.get('limit', 50))
    
    if private_room_id:
        messages = Message.query.filter_by(
            private_room_id=private_room_id, 
            is_deleted=False
        ).order_by(Message.timestamp.desc()).limit(limit).all()
    elif room_id:
        # Find room by name first
        room = ChatRoom.query.filter_by(name=room_id).first()
        if room:
            messages = Message.query.filter_by(
                room_id=room.id, 
                is_deleted=False
            ).order_by(Message.timestamp.desc()).limit(limit).all()
        else:
            # Try to find by ID
            messages = Message.query.filter_by(
                room_id=room_id, 
                is_deleted=False
            ).order_by(Message.timestamp.desc()).limit(limit).all()
    else:
        return jsonify({"error": "Room ID or Private Room ID required"}), 400
    
    return jsonify([msg.to_dict() for msg in reversed(messages)])

# Post new message
@app.route('/api/messages', methods=['POST'])
def post_message():
    try:
        data = request.json
        print(f"Received message data: {data}")
        
        if not data:
            return jsonify({"error": "No data provided"}), 400
        if 'content' not in data or 'walletAddress' not in data:
            return jsonify({"error": "Invalid message format - missing content or walletAddress"}), 400
        
        # Check if user exists or create new user
        sender = User.query.get(data['walletAddress'])
        if not sender:
            sender = User(
                wallet_address=data['walletAddress'],
                display_name=data.get('sender', f"User {data['walletAddress'][:6]}")
            )
            db.session.add(sender)
        
        # Update user's last activity
        sender.last_active = datetime.now()
        
        # Create message
        message = Message(
            content=data['content'],
            sender_id=data['walletAddress'],
            type=data.get('type', 'text'),
            file_url=data.get('fileUrl'),
            file_name=data.get('fileName')
        )
        
        # Set room or private chat
        if 'privateRoomId' in data:
            message.private_room_id = data['privateRoomId']
            room_for_socket = f"private_{data['privateRoomId']}"
        elif 'room' in data:
            # Find room by name
            room = ChatRoom.query.filter_by(name=data['room']).first()
            if room:
                message.room_id = room.id
                room_for_socket = f"room_{room.id}"
            else:
                # Try to find by ID
                room = ChatRoom.query.get(data['room'])
                if room:
                    message.room_id = room.id
                    room_for_socket = f"room_{room.id}"
                else:
                    # Create a new room if it doesn't exist
                    new_room = ChatRoom(data['room'], f"Chat room {data['room']}")
                    db.session.add(new_room)
                    db.session.flush()  # Get the ID without committing
                    message.room_id = new_room.id
                    room_for_socket = f"room_{new_room.id}"
        else:
            return jsonify({"error": "Room or Private Room ID required"}), 400
        
        db.session.add(message)
        db.session.commit()
        
        # Send message via WebSocket
        socketio.emit('new_message', message.to_dict(), room=room_for_socket)
        
        return jsonify(message.to_dict()), 201
    except Exception as e:
        print(f"Error in post_message: {str(e)}")
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

# Delete message
@app.route('/api/messages/<message_id>', methods=['DELETE'])
def delete_message(message_id):
    try:
        wallet_address = request.args.get('walletAddress')
        delete_for_all = request.args.get('deleteForAll', 'false').lower() == 'true'
        
        if not wallet_address:
            return jsonify({"error": "Wallet address required"}), 400
        
        message = Message.query.get(message_id)
        if not message:
            return jsonify({"error": "Message not found"}), 404
        
        if message.sender_id != wallet_address:
            return jsonify({"error": "You can only delete your own messages"}), 403
        
        if delete_for_all:
            message.is_deleted = True
            db.session.commit()
        else:
            # For user-only deletion, we'll treat it the same for simplicity
            message.is_deleted = True
            db.session.commit()
        
        # Determine room for WebSocket
        if message.private_room_id:
            room_for_socket = f"private_{message.private_room_id}"
        elif message.room_id:
            room_for_socket = f"room_{message.room_id}"
        else:
            room_for_socket = None
        
        # Send delete notification via WebSocket
        if room_for_socket:
            socketio.emit('message_deleted', {
                'messageId': message_id,
                'deleteForAll': delete_for_all,
                'walletAddress': wallet_address
            }, room=room_for_socket)
        
        return jsonify({"success": True, "messageId": message_id}), 200
    except Exception as e:
        print(f"Error in delete_message: {str(e)}")
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

# Upload file
@app.route('/api/upload', methods=['POST'])
def upload_file():
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No file part"}), 400
        
        file = request.files['file']
        wallet_address = request.form.get('walletAddress')
        
        if not wallet_address:
            return jsonify({"error": "Wallet address required"}), 400
        
        if file.filename == '':
            return jsonify({"error": "No selected file"}), 400
        
        if file and allowed_file(file.filename):
            filename = secure_filename(file.filename)
            timestamp = int(time.time())
            filename = f"{timestamp}_{filename}"
            
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(file_path)
            file_url = f"/static/uploads/{filename}"
            return jsonify({
                "success": True,
                "fileUrl": file_url,
                "fileName": file.filename
            }), 200
        else:
            return jsonify({"error": "File type not allowed"}), 400
    except Exception as e:
        print(f"Error in upload_file: {str(e)}")
        return jsonify({"error": str(e)}), 500

# Get user profile
@app.route('/api/profile', methods=['GET'])
def get_profile():
    wallet_address = request.args.get('walletAddress')
    
    if not wallet_address:
        return jsonify({"error": "Wallet address required"}), 400
    
    user = User.query.get(wallet_address)
    if user:
        return jsonify(user.to_dict()), 200
    else:
        default_profile = {
            "walletAddress": wallet_address,
            "displayName": f"User {wallet_address[:6]}",
            "avatar": f"https://api.dicebear.com/9.x/pixel-art/svg?seed={wallet_address}&hair=short01,short02,short03,short04,short05",
            "bio": ""
        }
        return jsonify(default_profile), 200

# Update profile
@app.route('/api/profile', methods=['POST'])
def update_profile():
    try:
        data = request.json
        wallet_address = data.get('walletAddress')
        
        if not wallet_address:
            return jsonify({"error": "Wallet address required"}), 400
        
        user = User.query.get(wallet_address)
        if user:
            user.display_name = data.get('displayName', user.display_name)
            user.avatar = data.get('avatar', user.avatar)
            user.bio = data.get('bio', user.bio)
            user.last_active = datetime.now()
        else:
            user = User(
                wallet_address=wallet_address,
                display_name=data.get('displayName'),
                avatar=data.get('avatar'),
                bio=data.get('bio')
            )
            db.session.add(user)
        
        db.session.commit()
        
        # Send profile update via WebSocket
        socketio.emit('profile_updated', user.to_dict())
        
        return jsonify(user.to_dict()), 200
    except Exception as e:
        print(f"Error in update_profile: {str(e)}")
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

# Upload avatar
@app.route('/api/profile/avatar', methods=['POST'])
def upload_avatar():
    try:
        if 'avatar' not in request.files:
            return jsonify({"error": "No avatar file"}), 400
        
        avatar = request.files['avatar']
        wallet_address = request.form.get('walletAddress')
        
        if not wallet_address:
            return jsonify({"error": "Wallet address required"}), 400
        
        if avatar.filename == '':
            return jsonify({"error": "No selected file"}), 400
        
        if avatar and allowed_file(avatar.filename):
            filename = secure_filename(avatar.filename)
            timestamp = int(time.time())
            filename = f"avatar_{wallet_address[:6]}_{timestamp}_{filename}"
            
            avatar_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            avatar.save(avatar_path)
            avatar_url = f"/static/uploads/{filename}"
            
            user = User.query.get(wallet_address)
            if user:
                user.avatar = avatar_url
                user.last_active = datetime.now()
            else:
                user = User(
                    wallet_address=wallet_address,
                    avatar=avatar_url
                )
                db.session.add(user)
            
            db.session.commit()
            
            # Send profile update via WebSocket
            socketio.emit('profile_updated', user.to_dict())
            
            return jsonify({
                "success": True,
                "avatar": avatar_url
            }), 200
        else:
            return jsonify({"error": "File type not allowed"}), 400
    except Exception as e:
        print(f"Error in upload_avatar: {str(e)}")
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

# Get available rooms
@app.route('/api/rooms', methods=['GET'])
def get_rooms():
    rooms = ChatRoom.query.filter_by(is_private=False).all()
    return jsonify({room.name: room.to_dict() for room in rooms})

# Get active users
@app.route('/api/users/active', methods=['GET'])
def get_active_users():
    try:
        # Get users active in the last 5 minutes
        five_minutes_ago = datetime.now() - timedelta(minutes=5)
        
        # Fixed query to avoid using timestamp() method
        active_users = User.query.filter(
            User.last_active > five_minutes_ago
        ).all()
        
        return jsonify({user.wallet_address: user.to_dict() for user in active_users})
    except Exception as e:
        print(f"Error in get_active_users: {str(e)}")
        return jsonify({"error": str(e)}), 500

# Get network status
@app.route('/api/network-status', methods=['GET'])
def network_status():
    try:
        if web3_available and w3 and w3.is_connected():
            try:
                latest_block = w3.eth.block_number
                gas_price = w3.eth.gas_price
                chain_id = w3.eth.chain_id
                
                try:
                    block = w3.eth.get_block('latest')
                    block_timestamp = block.timestamp
                    block_transactions = len(block.transactions)
                    block_hash = block.hash.hex()
                except Exception as e:
                    print(f"Error getting block data: {str(e)}")
                    block_timestamp = int(time.time())
                    block_transactions = 100
                    block_hash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
                
                return jsonify({
                    "connected": True,
                    "latestBlock": latest_block,
                    "gasPrice": str(gas_price),
                    "chainId": chain_id,
                    "blockTimestamp": block_timestamp,
                    "blockTransactions": block_transactions,
                    "blockHash": block_hash
                })
            except Exception as e:
                print(f"Error getting blockchain data: {str(e)}")
                return jsonify({
                    "connected": True,
                    "latestBlock": 12345678,
                    "gasPrice": "50000000000",
                    "chainId": 137,
                    "blockTimestamp": int(time.time()),
                    "blockTransactions": 100,
                    "blockHash": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
                })
        else:
            return jsonify({
                "connected": True,
                "latestBlock": 12345678,
                "gasPrice": "50000000000",
                "chainId": 137,
                "blockTimestamp": int(time.time()),
                "blockTransactions": 100,
                "blockHash": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
            })
    except Exception as e:
        print(f"Error in network_status: {str(e)}")
        return jsonify({"error": str(e), "connected": False}), 500


# Update user presence
@app.route('/api/user/presence', methods=['POST'])
def update_user_presence():
    try:
        data = request.json
        wallet_address = data.get('walletAddress')
        
        if not wallet_address:
            return jsonify({"error": "Wallet address required"}), 400
        
        user = User.query.get(wallet_address)
        if user:
            user.last_active = datetime.now()
            if data.get('name') and user.display_name != data.get('name'):
                user.display_name = data.get('name')
        else:
            user = User(
                wallet_address=wallet_address,
                display_name=data.get('name', f"User {wallet_address[:6]}")
            )
            db.session.add(user)
            
            # Send user connected notification via WebSocket
            socketio.emit('user_connected', {
                'userId': wallet_address,
                'name': user.display_name,
                'avatar': user.avatar
            })
        
        db.session.commit()
        return jsonify({"status": "success"}), 200
    except Exception as e:
        print(f"Error in update_user_presence: {str(e)}")
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

# --------- Friend System API Endpoints ---------

# Search users by wallet address
@app.route('/api/users/search', methods=['GET'])
def search_users():
    query = request.args.get('query', '')
    if not query or len(query) < 3:
        return jsonify({"error": "Search query must be at least 3 characters"}), 400
    
    try:
        # Search in wallet addresses and display names
        users = User.query.filter(
            (User.wallet_address.like(f"%{query}%")) | 
            (User.display_name.like(f"%{query}%"))
        ).limit(10).all()
        
        return jsonify([user.to_dict() for user in users])
    except Exception as e:
        print(f"Error in search_users: {str(e)}")
        return jsonify({"error": str(e)}), 500

# Send friend request
@app.route('/api/friends/request', methods=['POST'])
def send_friend_request():
    try:
        data = request.json
        print("Received friend request data:", data)  # Debug log
        
        sender_id = data.get('senderId')
        receiver_id = data.get('receiverId')
        
        if not sender_id or not receiver_id:
            return jsonify({"error": "Sender and receiver IDs required"}), 400
        
        # تحقق من وجود المستخدمين
        sender = User.query.get(sender_id)
        receiver = User.query.get(receiver_id)
        
        if not sender or not receiver:
            return jsonify({"error": "Sender or receiver not found"}), 404
        
        # تحقق من عدم وجود طلب مسبق
        existing_request = db.session.query(friend_requests).filter_by(
            sender_id=sender_id, 
            receiver_id=receiver_id
        ).first()
        
        if existing_request:
            return jsonify({"error": "Friend request already sent"}), 400
        
        # أضف إدخالًا جديدًا
        stmt = friend_requests.insert().values(
            sender_id=sender_id,
            receiver_id=receiver_id,
            status='pending',
            created_at=datetime.now()
        )
        db.session.execute(stmt)
        db.session.commit()
        
        # أرسل إشعارًا عبر WebSocket
        socketio.emit('friend_request', {
            'senderId': sender_id,
            'senderName': sender.display_name,
            'senderAvatar': sender.avatar,
            'receiverId': receiver_id,
            'status': 'pending',
            'createdAt': datetime.now().isoformat()
        }, room=f"user_{receiver_id}")
        
        return jsonify({"success": True, "message": "Friend request sent"}), 201
    except Exception as e:
        print(f"Error in send_friend_request: {str(e)}")
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

# Accept or reject friend request
@app.route('/api/friends/request/<action>', methods=['POST'])
def handle_friend_request(action):
    try:
        if action not in ['accept', 'reject']:
            return jsonify({"error": "Invalid action"}), 400
        
        data = request.json
        sender_id = data.get('senderId')
        receiver_id = data.get('receiverId')
        
        if not sender_id or not receiver_id:
            return jsonify({"error": "Sender and receiver IDs required"}), 400
        
        # Check if friend request exists
        existing_request = db.session.query(friend_requests).filter_by(
            sender_id=sender_id, receiver_id=receiver_id, status='pending'
        ).first()
        
        if not existing_request:
            return jsonify({"error": "Friend request not found"}), 404
        
        if action == 'accept':
            # Add friendship relationship
            stmt1 = friends.insert().values(
                user_id=sender_id,
                friend_id=receiver_id,
                created_at=datetime.now()
            )
            stmt2 = friends.insert().values(
                user_id=receiver_id,
                friend_id=sender_id,
                created_at=datetime.now()
            )
            db.session.execute(stmt1)
            db.session.execute(stmt2)
            
            # Update friend request status
            db.session.query(friend_requests).filter_by(
                sender_id=sender_id, receiver_id=receiver_id
            ).update({"status": "accepted"})
            
            # Create private chat room
            private_room = PrivateChatRoom(sender_id, receiver_id)
            db.session.add(private_room)
            db.session.commit()
            
            # Send friend request accepted notification via WebSocket
            sender = User.query.get(sender_id)
            receiver = User.query.get(receiver_id)
            
            socketio.emit('friend_request_accepted', {
                'senderId': sender_id,
                'senderName': sender.display_name,
                'senderAvatar': sender.avatar,
                'receiverId': receiver_id,
                'receiverName': receiver.display_name,
                'receiverAvatar': receiver.avatar,
                'privateRoomId': private_room.id
            }, room=f"user_{sender_id}")
            
            return jsonify({
                "success": True,
                "message": "Friend request accepted",
                "privateRoomId": private_room.id
            }), 200
        else:  # reject
            # Update friend request status
            db.session.query(friend_requests).filter_by(
                sender_id=sender_id, receiver_id=receiver_id
            ).update({"status": "rejected"})
            db.session.commit()
            
            # Send friend request rejected notification via WebSocket
            socketio.emit('friend_request_rejected', {
                'senderId': sender_id,
                'receiverId': receiver_id
            }, room=f"user_{sender_id}")
            
            return jsonify({
                "success": True,
                "message": "Friend request rejected"
            }), 200
    except Exception as e:
        print(f"Error in handle_friend_request: {str(e)}")
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

# Get friends list
@app.route('/api/friends', methods=['GET'])
def get_friends():
    wallet_address = request.args.get('walletAddress')
    
    if not wallet_address:
        return jsonify({"error": "Wallet address required"}), 400
    
    user = User.query.get(wallet_address)
    if not user:
        return jsonify({"error": "User not found"}), 404
    
    # Get friends list
    friend_list = []
    for friend in user.friends_rel:
        # Find private chat room
        private_room = PrivateChatRoom.query.filter(
            ((PrivateChatRoom.user1_id == wallet_address) & (PrivateChatRoom.user2_id == friend.wallet_address)) |
            ((PrivateChatRoom.user1_id == friend.wallet_address) & (PrivateChatRoom.user2_id == wallet_address))
        ).first()
        
        friend_data = friend.to_dict()
        if private_room:
            friend_data['privateRoomId'] = private_room.id
        
        friend_list.append(friend_data)
    
    return jsonify(friend_list)

# Get friend requests
@app.route('/api/friends/requests', methods=['GET'])
def get_friend_requests():
    wallet_address = request.args.get('walletAddress')
    request_type = request.args.get('type', 'received')  # received or sent
    
    if not wallet_address:
        return jsonify({"error": "Wallet address required"}), 400
    
    if request_type == 'received':
        # Get received friend requests
        requests = db.session.query(friend_requests).filter_by(
            receiver_id=wallet_address, status='pending'
        ).all()
        
        result = []
        for req in requests:
            sender = User.query.get(req.sender_id)
            if sender:
                result.append({
                    'senderId': sender.wallet_address,
                    'senderName': sender.display_name,
                    'senderAvatar': sender.avatar,
                    'status': req.status,
                    'createdAt': req.created_at.isoformat() if req.created_at else None
                })
        
        return jsonify(result)
    else:  # sent
        # Get sent friend requests
        requests = db.session.query(friend_requests).filter_by(
            sender_id=wallet_address
        ).all()
        
        result = []
        for req in requests:
            receiver = User.query.get(req.receiver_id)
            if receiver:
                result.append({
                    'receiverId': receiver.wallet_address,
                    'receiverName': receiver.display_name,
                    'receiverAvatar': receiver.avatar,
                    'status': req.status,
                    'createdAt': req.created_at.isoformat() if req.created_at else None
                })
        
        return jsonify(result)

# Get private chats
@app.route('/api/private-chats', methods=['GET'])
def get_private_chats():
    wallet_address = request.args.get('walletAddress')
    
    if not wallet_address:
        return jsonify({"error": "Wallet address required"}), 400
    
    # Get all private chats for user
    private_rooms = PrivateChatRoom.query.filter(
        (PrivateChatRoom.user1_id == wallet_address) | (PrivateChatRoom.user2_id == wallet_address)
    ).all()
    
    result = []
    for room in private_rooms:
        # Determine other user in chat
        other_user_id = room.user2_id if room.user1_id == wallet_address else room.user1_id
        other_user = User.query.get(other_user_id)
        
        if other_user:
            # Get last message in chat
            last_message = Message.query.filter_by(
                private_room_id=room.id, is_deleted=False
            ).order_by(Message.timestamp.desc()).first()
            
            chat_data = {
                'id': room.id,
                'userId': other_user.wallet_address,
                'displayName': other_user.display_name,
                'avatar': other_user.avatar,
                'lastActive': other_user.last_active.isoformat() if other_user.last_active else None,
                'lastMessage': last_message.to_dict() if last_message else None
            }
            
            result.append(chat_data)
    
    return jsonify(result)

# --------------------- WebSocket Handlers ---------------------

@socketio.on('connect')
def handle_connect():
    print('Client connected')

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@socketio.on('send_message')
def handle_send_message(data):
    try:
        message = Message.query.get(data['messageId'])
        if message:
            room = f"room_{message.room_id}" if message.room_id else f"private_{message.private_room_id}"
            emit('new_message', message.to_dict(), room=room)
    except Exception as e:
        print(f"Error sending message via socket: {str(e)}")    

@socketio.on('join')
def handle_join(data):
    try:
        room_type = data.get('type', 'public')  # public, private, or user
        room_id = data.get('roomId')
        
        if room_type == 'public':
            # Join public room
            room = ChatRoom.query.filter_by(name=room_id).first()
            if not room:
                room = ChatRoom.query.get(room_id)
            
            if room:
                join_room(f"room_{room.id}")
                print(f"Client joined public room: {room.name}")
                emit('joined', {'room': room.name, 'type': 'public'})
        elif room_type == 'private':
            # Join private chat
            private_room = PrivateChatRoom.query.get(room_id)
            if private_room:
                join_room(f"private_{private_room.id}")
                print(f"Client joined private room: {private_room.id}")
                emit('joined', {'room': private_room.id, 'type': 'private'})
        elif room_type == 'user':
            # Join user room for notifications
            user_id = room_id
            join_room(f"user_{user_id}")
            print(f"Client joined user room: {user_id}")
            emit('joined', {'room': user_id, 'type': 'user'})
    except Exception as e:
        print(f"Error in handle_join: {str(e)}")

@socketio.on('leave')
def handle_leave(data):
    try:
        room_type = data.get('type', 'public')
        room_id = data.get('roomId')
        
        if room_type == 'public':
            room = ChatRoom.query.filter_by(name=room_id).first()
            if not room:
                room = ChatRoom.query.get(room_id)
                
            if room:
                leave_room(f"room_{room.id}")
                print(f"Client left public room: {room.name}")
        elif room_type == 'private':
            private_room = PrivateChatRoom.query.get(room_id)
            if private_room:
                leave_room(f"private_{private_room.id}")
                print(f"Client left private room: {private_room.id}")
        elif room_type == 'user':
            user_id = room_id
            leave_room(f"user_{user_id}")
            print(f"Client left user room: {user_id}")
    except Exception as e:
        print(f"Error in handle_leave: {str(e)}")

@socketio.on('typing')
def handle_typing(data):
    try:
        room_type = data.get('type', 'public')
        room_id = data.get('roomId')
        user_id = data.get('userId')
        is_typing = data.get('isTyping', False)
        
        if not user_id:
            return
        
        room_name = None
        if room_type == 'public':
            room = ChatRoom.query.filter_by(name=room_id).first()
            if not room:
                room = ChatRoom.query.get(room_id)
                
            if room:
                room_name = f"room_{room.id}"
        elif room_type == 'private':
            private_room = PrivateChatRoom.query.get(room_id)
            if private_room:
                room_name = f"private_{private_room.id}"
        
        if room_name:
            user = User.query.get(user_id)
            emit('user_typing', {
                'userId': user_id,
                'displayName': user.display_name if user else f"User {user_id[:6]}",
                'isTyping': is_typing
            }, room=room_name, include_self=False)
    except Exception as e:
        print(f"Error in handle_typing: {str(e)}")

# Enable CORS for all requests
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

if __name__ == '__main__':
   
    socketio.run(app,allow_unsafe_werkzeug=True)


