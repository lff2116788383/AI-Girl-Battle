package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"ai-girl-battle-server/internal/model"

	"gorm.io/gorm"
)

// ConfigService 配置中心：服务端权威数值
// - 启动时若 configs/ 下的种子 JSON 对应 key 不存在则入库（首装种子）
// - 任一包更新时递增全局 configVersion
type ConfigService struct {
	db  *gorm.DB
	mu  sync.Mutex
}

func NewConfigService(db *gorm.DB) *ConfigService {
	return &ConfigService{db: db}
}

// SeedFromDir 首装种子：把 configs/*.json 灌入数据库（已存在的 key 跳过，不覆盖线上配置）
func (s *ConfigService) SeedFromDir(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // 无种子目录，跳过
		}
		return err
	}
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		key := filepath.Base(e.Name()[:len(e.Name())-5]) // 去掉 .json
		var count int64
		s.db.Model(&model.ConfigPackage{}).Where("key = ?", key).Count(&count)
		if count > 0 {
			continue
		}
		payload, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return err
		}
		var probe map[string]interface{}
		if err := json.Unmarshal(payload, &probe); err != nil {
			return fmt.Errorf("种子配置 %s 不是合法 JSON: %w", key, err)
		}
		if err := s.db.Create(&model.ConfigPackage{
			Key:     key,
			Payload: string(payload),
			Version: 1,
			Remark:  "首装种子（来自客户端 configs/）",
		}).Error; err != nil {
			return err
		}
		fmt.Printf("配置种子已入库: %s (%d bytes)\n", key, len(payload))
	}
	return nil
}

// GetVersion 全局配置版本
func (s *ConfigService) GetVersion() (int, error) {
	var meta model.ConfigMeta
	if err := s.db.First(&meta, 1).Error; err != nil {
		return 0, err
	}
	return meta.ConfigVersion, nil
}

// GetAll 全量配置包（key → payload 原始 JSON）
func (s *ConfigService) GetAll() (int, map[string]json.RawMessage, error) {
	var packages []model.ConfigPackage
	if err := s.db.Find(&packages).Error; err != nil {
		return 0, nil, err
	}
	version, err := s.GetVersion()
	if err != nil {
		return 0, nil, err
	}
	configs := make(map[string]json.RawMessage, len(packages))
	for _, p := range packages {
		configs[p.Key] = json.RawMessage(p.Payload)
	}
	return version, configs, nil
}

// GetKey 单个配置包
func (s *ConfigService) GetKey(key string) (*model.ConfigPackage, error) {
	var p model.ConfigPackage
	if err := s.db.Where("key = ?", key).First(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// UpsertKey 更新/新建配置包（管理端），并递增全局版本
func (s *ConfigService) UpsertKey(key, payload, remark string) (*model.ConfigPackage, error) {
	// 合法 JSON 校验
	var probe map[string]interface{}
	if err := json.Unmarshal([]byte(payload), &probe); err != nil {
		return nil, errors.New("payload 不是合法 JSON 对象")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	var p model.ConfigPackage
	err := s.db.Where("key = ?", key).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		p = model.ConfigPackage{Key: key, Payload: payload, Version: 1, Remark: remark}
		err = s.db.Create(&p).Error
	} else if err == nil {
		p.Payload = payload
		p.Version++
		if remark != "" {
			p.Remark = remark
		}
		err = s.db.Save(&p).Error
	}
	if err != nil {
		return nil, err
	}

	// 递增全局 configVersion
	if err := s.db.Model(&model.ConfigMeta{}).Where("id = 1").
		UpdateColumn("config_version", gorm.Expr("config_version + 1")).Error; err != nil {
		return nil, err
	}
	return &p, nil
}
