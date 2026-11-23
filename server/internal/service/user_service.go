package service

import (
	"encoding/json"
	"errors"
	"fmt"

	"ai-girl-battle-server/internal/model"

	"github.com/go-redis/redis/v8"
	"gorm.io/gorm"
)

// UserService 用户登录 / 资料 / 云存档
type UserService struct {
	db    *gorm.DB
	redis *redis.Client // 可为 nil（无缓存模式）
}

func NewUserService(db *gorm.DB, redis *redis.Client) *UserService {
	return &UserService{db: db, redis: redis}
}

// Login 登录（不存在则自动建号，注册与登录合一）
func (s *UserService) Login(openID string, userInfo map[string]interface{}) (*model.User, error) {
	if openID == "" {
		return nil, errors.New("open_id 不能为空")
	}

	var user model.User
	result := s.db.Where("open_id = ?", openID).First(&user)
	if result.Error != nil {
		if !errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, result.Error
		}
		// 建新用户 + 初始存档
		user = model.User{OpenID: openID}
		if userInfo != nil {
			if name, ok := userInfo["nickname"].(string); ok && name != "" {
				user.Nickname = name
			}
			if avatar, ok := userInfo["avatar"].(string); ok {
				user.Avatar = avatar
			}
		}
		if err := s.db.Create(&user).Error; err != nil {
			return nil, err
		}
		if user.Nickname == "" {
			// 建号后用 ID 兜底昵称
			s.db.Model(&user).Update("nickname", fmt.Sprintf("站长%d", user.ID))
		}
		if err := s.db.Create(&model.UserState{
			UserID:    user.ID,
			StateJSON: "{}",
			Version:   1,
		}).Error; err != nil {
			return nil, err
		}
	}
	return &user, nil
}

// GetUserByID 根据 ID 获取用户
func (s *UserService) GetUserByID(userID uint) (*model.User, error) {
	var user model.User
	if err := s.db.First(&user, userID).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

// UpdateUser 更新用户字段（白名单校验）
var userUpdatableFields = map[string]bool{
	"nickname": true, "avatar": true, "coins": true, "tokens": true,
	"feed": true, "ice_packs": true, "level": true,
}

func (s *UserService) UpdateUser(userID uint, updates map[string]interface{}) error {
	safe := map[string]interface{}{}
	for k, v := range updates {
		if userUpdatableFields[k] {
			safe[k] = v
		}
	}
	if len(safe) == 0 {
		return errors.New("无可更新字段")
	}
	return s.db.Model(&model.User{}).Where("id = ?", userID).Updates(safe).Error
}

// GetState 读取云存档
func (s *UserService) GetState(userID uint) (*model.UserState, error) {
	var state model.UserState
	if err := s.db.Where("user_id = ?", userID).First(&state).Error; err != nil {
		return nil, err
	}
	return &state, nil
}

// SaveState 写云存档（带乐观锁：客户端携带的 version 不匹配则拒绝，防多端互踩）
func (s *UserService) SaveState(userID uint, stateJSON string, clientVersion int) (*model.UserState, error) {
	var state model.UserState
	if err := s.db.Where("user_id = ?", userID).First(&state).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		state = model.UserState{UserID: userID}
	}
	if clientVersion > 0 && state.Version != 0 && clientVersion != state.Version {
		return nil, fmt.Errorf("存档版本冲突: 客户端 %d, 服务端 %d（请先 GET /user/state 同步）",
			clientVersion, state.Version)
	}
	// 校验是合法 JSON 再落库
	var probe map[string]interface{}
	if err := json.Unmarshal([]byte(stateJSON), &probe); err != nil {
		return nil, errors.New("state_json 不是合法 JSON")
	}
	state.StateJSON = stateJSON
	state.Version++
	if err := s.db.Save(&state).Error; err != nil {
		return nil, err
	}
	return &state, nil
}
