import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Badge, Button } from '@toss/tds-mobile';
import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import './styles.css';

const API_BASE = (import.meta.env.VITE_SMART_HOME_API_BASE || `${window.location.protocol}//${window.location.hostname}:4176`).replace(/\/$/, '');
const NOTIFICATION_LIMIT = 30;
const API_KEY = import.meta.env.VITE_SMART_HOME_API_KEY || '';

const apiFetch = (path, options = {}) => fetch(`${API_BASE}${path}`, {
  ...options,
  headers: {
    ...(options.headers || {}),
    ...(API_KEY ? { 'X-Smart-Home-Key': API_KEY } : {}),
  },
});

const initialLights = [
  { name: '방1', checked: true },
  { name: '방2', checked: false },
  { name: '방3', checked: false },
  { name: '복도', checked: true },
  { name: '안방', checked: true },
  { name: '거실', checked: true },
  { name: '화장실1', checked: false },
  { name: '화장실2', checked: false },
  { name: '부엌1', checked: true },
  { name: '부엌2', checked: false },
];

const initialDevices = [
  { name: '에어컨', status: '냉방 중', detail: '설정 24°C', checked: true, color: 'blue' },
  { name: '건조기', status: '표준 건조', detail: '종료 후 보관', checked: false, color: 'elephant' },
  { name: '세탁기', status: '세탁 중', detail: '32분 남음', checked: true, color: 'green' },
  { name: '로보락', status: '충전 중', detail: '배터리 87%', checked: false, color: 'blue' },
];

// const initialHeating = [
//   { name: '방1', temp: 23, target: 24, on: true },
//   { name: '방2', temp: 22, target: 23, on: false },
//   { name: '방3', temp: 22, target: 23, on: false },
//   { name: '안방', temp: 23, target: 24, on: true },
//   { name: '거실', temp: 24, target: 24, on: false },
// ];

const findStatusValue = (source, matcher) => {
  if (!source || typeof source !== 'object') {
    return undefined;
  }
  for (const [key, value] of Object.entries(source)) {
    if (matcher(key) && value && typeof value === 'object' && 'value' in value) {
      return value.value;
    }
    if (matcher(key) && (typeof value === 'string' || typeof value === 'number')) {
      return value;
    }
    const nested = findStatusValue(value, matcher);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
};

const modeLabelMap = {
  auto: '자동',
  low: '약풍',
  medium: '중풍',
  mid: '중풍',
  high: '강풍',
  turbo: '터보',
  sleep: '취침',
  quiet: '저소음',
  wind: '송풍',
  cooling: '냉방',
  dry: '제습',
};

const toModeLabel = (value) => {
  if (value == null) {
    return value;
  }
  return modeLabelMap[String(value).toLowerCase()] || value;
};

function App() {
  const dragTimerRef = useRef(null);
  const scrollTimerRef = useRef(null);
  const sheetScrollTimerRef = useRef(null);
  const carouselDragRef = useRef(null);
  const pageDragRef = useRef(null);
  const sheetDragRef = useRef(null);
  const reorderPointerRef = useRef(null);
  const suppressClickRef = useRef(false);
  const scheduleRunsRef = useRef(new Set());
  const [draggingItem, setDraggingItem] = useState(null);
  const [carouselScrolling, setCarouselScrolling] = useState(false);
  const [carouselBar, setCarouselBar] = useState({ left: 0, width: 100 });
  const [sheetScrolling, setSheetScrolling] = useState(false);
  const [refreshingDeviceId, setRefreshingDeviceId] = useState(null);
  const [idle, setIdle] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const hour = new Date().getHours();
    return hour >= 22 || hour < 6;
  });
  const [lights, setLights] = useState(initialLights);
  const [lightingCollapsed, setLightingCollapsed] = useState(false);
  const [devices, setDevices] = useState(initialDevices);
  const [applianceCollapsed, setApplianceCollapsed] = useState(false);
  // const [heating, setHeating] = useState(initialHeating);
  const dismissedNotificationIdsRef = useRef(new Set(JSON.parse(window.localStorage.getItem('toss-smart-home-dismissed-notifications') || '[]')));
  const [notifications, setNotifications] = useState([]);
  const [closingNotifications, setClosingNotifications] = useState([]);
  const visibleNotifications = notifications.filter(notification => !closingNotifications.includes(notification.id));
  const [settingsDevice, setSettingsDevice] = useState(null);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const [airconTemp, setAirconTemp] = useState(24);
  const [airconMode, setAirconMode] = useState('냉방');
  const [washerCourse, setWasherCourse] = useState('표준');
  const [dryerCourse, setDryerCourse] = useState('표준 건조');
  const [vacuumPower, setVacuumPower] = useState('일반');
  const [airPurifierMode, setAirPurifierMode] = useState('자동');
  const [deviceSchedules, setDeviceSchedules] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem('toss-smart-home-device-schedules') || '{}');
    } catch {
      return {};
    }
  });
  const [schedulePicker, setSchedulePicker] = useState(null);
  const [schedulePickerClosing, setSchedulePickerClosing] = useState(false);
  const [screenBrightness, setScreenBrightness] = useState(70);
  const [screenTimeout, setScreenTimeout] = useState('30초');
  const [autoDarkMode, setAutoDarkMode] = useState(true);
  const [presenceDetection, setPresenceDetection] = useState(true);
  const [presenceSensitivity, setPresenceSensitivity] = useState('보통');
  const [smartThingsStatus, setSmartThingsStatus] = useState('disconnected');
  const [stationConnected, setStationConnected] = useState(false);
  const [smartThingsToken, setSmartThingsToken] = useState('');
  const [smartThingsApiLog, setSmartThingsApiLog] = useState('토큰을 입력하면 기기 동기화를 준비할 수 있어요.');
  const lightOnCount = lights.filter(light => light.checked).length;
  const hasLightOn = lightOnCount > 0;
  const activeDeviceCount = devices.filter(device => device.checked).length;
  const selectedDevice = settingsDevice ? devices.find(device => device.name === settingsDevice) : null;
  const selectedCapabilities = selectedDevice?.capabilities ?? [];
  const selectedIsAirPurifier = selectedDevice && (
    /공기청정|air purifier/i.test(selectedDevice.name) ||
    selectedCapabilities.some(id => /air|fan/i.test(id))
  );

  const addNotification = (title, message, options = {}) => {
    const notification = {
      id: options.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      message,
      createdAt: options.createdAt || new Date().toISOString(),
    };
    setNotifications(prev => [notification, ...prev].slice(0, NOTIFICATION_LIMIT));
    if (options.localOnly) {
      return;
    }
    apiFetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
    }).catch(() => {});
  };

  const dismissNotification = (id) => {
    if (closingNotifications.includes(id)) {
      return;
    }
    dismissedNotificationIdsRef.current.add(id);
    window.localStorage.setItem(
      'toss-smart-home-dismissed-notifications',
      JSON.stringify(Array.from(dismissedNotificationIdsRef.current).slice(-200)),
    );
    setClosingNotifications(prev => [...prev, id]);
    window.setTimeout(() => {
      setNotifications(prev => prev.filter(item => item.id !== id));
      setClosingNotifications(prev => prev.filter(item => item !== id));
      apiFetch(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    }, 210);
  };

  useEffect(() => {
    const loadNotifications = async () => {
      try {
        const response = await apiFetch('/api/notifications');
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        const backendNotifications = (Array.isArray(data.notifications) ? data.notifications : [])
          .filter(notification => !dismissedNotificationIdsRef.current.has(notification.id));
        setNotifications(prev => {
          const merged = [...backendNotifications, ...prev];
          return Array.from(new Map(merged.map(item => [item.id, item])).values())
            .filter(notification => !dismissedNotificationIdsRef.current.has(notification.id))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, NOTIFICATION_LIMIT);
        });
      } catch {
        // 백엔드가 꺼져 있어도 화면 내 알림은 그대로 동작해요.
      }
    };
    loadNotifications();
    const timer = window.setInterval(loadNotifications, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.localStorage.setItem('toss-smart-home-device-schedules', JSON.stringify(deviceSchedules));
    apiFetch('/api/schedules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedules: deviceSchedules, devices }),
    })
      .then(async (response) => {
        if (!response.ok) {
          return;
        }
        const data = await response.json().catch(() => null);
        if (data?.rules?.ok && !data.rules.skipped) {
          setSmartThingsApiLog(`예약을 SmartThings 루틴 ${data.rules.count || 0}개로 저장했어요.`);
        }
        if (data?.rules?.ok === false && data.rules.reason !== 'missing-token') {
          setSmartThingsApiLog(`예약은 저장됐지만 SmartThings 루틴 반영은 실패했어요. ${data.rules.error || ''}`.trim());
        }
      })
      .catch(() => {
      setSmartThingsApiLog('예약은 화면에 저장됐지만 백엔드가 꺼져 있어 실제 실행은 대기 중이에요.');
      });
  }, [deviceSchedules, devices]);

  useEffect(() => {
    if (!smartThingsToken.trim()) {
      return;
    }
    apiFetch('/api/token', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: smartThingsToken.trim() }),
    }).catch(() => {
      setSmartThingsApiLog('토큰은 화면에 입력됐지만 백엔드 저장은 실패했어요.');
    });
  }, [smartThingsToken]);

  useEffect(() => {
    const dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
    const checkSchedules = () => {
      const now = new Date();
      const parts = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(now);
      const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
      const dateKey = `${value.year}-${value.month}-${value.day}`;
      const timeKey = `${value.hour}:${value.minute}`;
      const koreanDay = dayLabels[new Date(`${dateKey}T00:00:00+09:00`).getDay()];

      Object.entries(deviceSchedules).forEach(([scheduleKey, schedule]) => {
        if (!schedule || !Array.isArray(schedule.days) || !schedule.days.includes(koreanDay)) {
          return;
        }
        ['on', 'off'].forEach((field) => {
          if (schedule[field] !== timeKey) {
            return;
          }
          const runKey = `${scheduleKey}:${field}:${dateKey}:${timeKey}`;
          if (scheduleRunsRef.current.has(runKey)) {
            return;
          }
          const targetDevice = devices.find(device => (
            device.deviceId === scheduleKey ||
            device.name === scheduleKey ||
            device.label === scheduleKey
          ));
          if (!targetDevice) {
            return;
          }
          scheduleRunsRef.current.add(runKey);
          const checked = field === 'on';
          addNotification(
            `${targetDevice.name}${checked ? ' 켜짐' : ' 꺼짐'}`,
            `예약한 시간 ${timeKey}에 ${checked ? '켜졌어요.' : '꺼졌어요.'}`,
            { id: `local-schedule-${runKey}`, localOnly: true },
          );
          setDevices(prev => prev.map(device => (
            device.deviceId === scheduleKey ||
            device.name === scheduleKey ||
            device.label === scheduleKey
              ? { ...device, checked, status: checked ? '켜짐' : '대기' }
              : device
          )));
        });
      });
    };

    checkSchedules();
    const timer = window.setInterval(checkSchedules, 1_000);
    return () => window.clearInterval(timer);
  }, [deviceSchedules, devices]);

  const sendDeviceCommand = async (device, capability, command, args = []) => {
    if (!device?.deviceId || !smartThingsToken.trim()) {
      setSmartThingsApiLog('명령 실패. SmartThings 토큰과 기기 ID가 필요해요.');
      return;
    }
    try {
      const response = await apiFetch(`/api/devices/${device.deviceId}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commands: [{
            component: device.componentId || 'main',
            capability,
            command,
            arguments: args,
          }],
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (capability === 'fanMode' || capability === 'airConditionerFanMode') {
        setDevices(prev => prev.map(item => item.deviceId === device.deviceId ? {
          ...item,
          status: toModeLabel(args[0]) || item.status,
        } : item));
      }
      setSmartThingsApiLog(`${device.name} 명령 전송 완료: ${command}`);
    } catch (error) {
      setSmartThingsApiLog(`명령 실패: ${error.message}`);
    }
  };
  const refreshDeviceStatus = async (device) => {
    if (!device?.deviceId || !smartThingsToken.trim()) {
      setSmartThingsApiLog('상태 새로고침 실패. SmartThings 토큰과 기기 ID가 필요해요.');
      return;
    }
    setRefreshingDeviceId(device.deviceId);
    try {
      const response = await fetch(`https://api.smartthings.com/v1/devices/${device.deviceId}/status`, {
        headers: {
          Authorization: `Bearer ${smartThingsToken.trim()}`,
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const status = await response.json();
      const componentStatus = status.components?.main ?? {};
      const switchValue = componentStatus.switch?.switch?.value;
      const filterValue =
        componentStatus.filterState?.filterLifeRemaining?.value ??
        componentStatus.dustFilter?.dustFilterStatus?.value ??
        componentStatus.airFilter?.filterLifeRemaining?.value ??
        findStatusValue(componentStatus, key => /filter/i.test(key) && /(life|remain|percent|status)/i.test(key));
      const airQualityValue =
        componentStatus.airQualitySensor?.airQuality?.value ??
        componentStatus.fineDustSensor?.fineDustLevel?.value ??
        componentStatus.veryFineDustSensor?.veryFineDustLevel?.value ??
        findStatusValue(componentStatus, key => /(airQuality|dust|pm25|pm10|fineDust)/i.test(key));
      setDevices(prev => prev.map(item => item.deviceId === device.deviceId ? {
        ...item,
        statusPayload: componentStatus,
        checked: switchValue ? switchValue === 'on' : item.checked,
        airQuality: airQualityValue,
        filterLife: filterValue,
        detail: filterValue != null ? `필터 ${filterValue}%` : item.detail,
      } : item));
      setSmartThingsApiLog(`${device.name} 상태를 새로고침했어요.`);
    } catch (error) {
      setSmartThingsApiLog(`상태 새로고침 실패: ${error.message}`);
    } finally {
      window.setTimeout(() => setRefreshingDeviceId(null), 650);
    }
  };
  const toggleDevice = async (targetIndex) => {
    const targetDevice = devices[targetIndex];
    const nextChecked = !targetDevice.checked;
    setDevices(prev => prev.map((item, i) => i === targetIndex ? { ...item, checked: nextChecked } : item));
    addNotification(
      `${targetDevice.name}${nextChecked ? ' 켜짐' : ' 꺼짐'}`,
      `가전이 ${nextChecked ? '켜졌어요.' : '꺼졌어요.'}`,
    );
    if (!targetDevice.deviceId || !smartThingsToken.trim() || !targetDevice.capabilities?.includes('switch')) {
      return;
    }
    try {
      await apiFetch(`/api/devices/${targetDevice.deviceId}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commands: [{
            component: targetDevice.componentId || 'main',
            capability: 'switch',
            command: nextChecked ? 'on' : 'off',
          }],
        }),
      });
    } catch {
      setSmartThingsApiLog('전원 명령 전송에 실패했어요. 백엔드와 토큰 상태를 확인해주세요.');
    }
  };
  const reorderItems = (items, from, to) => {
    if (from === to) {
      return items;
    }
    const nextItems = [...items];
    const [movedItem] = nextItems.splice(from, 1);
    nextItems.splice(to, 0, movedItem);
    return nextItems;
  };

  const armDrag = (event, type, index) => {
    clearTimeout(dragTimerRef.current);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    reorderPointerRef.current = {
      pointerId: event.pointerId,
      type,
      index,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    dragTimerRef.current = setTimeout(() => {
      const pointer = reorderPointerRef.current;
      if (!pointer || pointer.pointerId !== event.pointerId) {
        return;
      }
      pointer.active = true;
      suppressClickRef.current = true;
      setDraggingItem({ type, index });
    }, 430);
  };

  const cancelArmDrag = () => {
    clearTimeout(dragTimerRef.current);
  };

  const updateCarouselBar = (element) => {
    const maxScroll = element.scrollWidth - element.clientWidth;
    if (maxScroll <= 0) {
      setCarouselBar({ left: 0, width: 100 });
      return;
    }
    const width = Math.max(18, (element.clientWidth / element.scrollWidth) * 100);
    const left = (element.scrollLeft / maxScroll) * (100 - width);
    setCarouselBar({ left, width });
  };

  const showCarouselScroll = (element) => {
    updateCarouselBar(element);
    setCarouselScrolling(true);
    clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => setCarouselScrolling(false), 900);
  };

  const showSheetScroll = () => {
    setSheetScrolling(true);
    clearTimeout(sheetScrollTimerRef.current);
    sheetScrollTimerRef.current = setTimeout(() => setSheetScrolling(false), 900);
  };

  const startVerticalScroll = (event, ref) => {
    if (!event.isPrimary) {
      return;
    }
    const interactiveTarget = event.target.closest?.('button, input, textarea, select, a, [role="button"], .room-carousel');
    if (interactiveTarget) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    ref.current = {
      pointerId: event.pointerId,
      y: event.clientY,
      scrollTop: event.currentTarget.scrollTop,
      moved: false,
    };
  };

  const moveVerticalScroll = (event, ref, onScrollMove) => {
    const drag = ref.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const deltaY = event.clientY - drag.y;
    if (Math.abs(deltaY) > 4) {
      drag.moved = true;
      suppressClickRef.current = true;
      event.preventDefault();
      event.currentTarget.scrollTop = drag.scrollTop - deltaY;
      onScrollMove?.();
    }
  };

  const endVerticalScroll = (ref) => {
    ref.current = null;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 100);
  };

  const openSettings = (deviceName) => {
    setSettingsClosing(false);
    setSettingsDevice(deviceName);
  };

  const closeSettings = () => {
    setSettingsClosing(true);
    window.setTimeout(() => {
      setSettingsDevice(null);
      setSettingsClosing(false);
    }, 220);
  };

  const setDeviceSchedule = (scheduleKey, updater) => {
    setDeviceSchedules(prev => ({
      ...prev,
      [scheduleKey]: typeof updater === 'function'
        ? updater(prev[scheduleKey] || {})
        : updater,
    }));
  };

  const openSchedulePicker = (scheduleKey, field, label) => {
    setSchedulePickerClosing(false);
    setSchedulePicker({ scheduleKey, field, label });
  };

  const closeSchedulePicker = () => {
    setSchedulePickerClosing(true);
    window.setTimeout(() => {
      setSchedulePicker(null);
      setSchedulePickerClosing(false);
    }, 180);
  };

  const startCarouselScroll = (event) => {
    carouselDragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
  };

  const moveCarouselScroll = (event) => {
    if (reorderPointerRef.current?.active) {
      event.preventDefault();
      return;
    }
    const drag = carouselDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - drag.x;
    if (Math.abs(deltaX) > 5) {
      drag.moved = true;
      suppressClickRef.current = true;
      cancelArmDrag();
      event.currentTarget.scrollLeft = drag.scrollLeft - deltaX;
      showCarouselScroll(event.currentTarget);
    }
  };

  const endCarouselScroll = () => {
    carouselDragRef.current = null;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 80);
  };

  const moveReorderPointer = (event) => {
    const pointer = reorderPointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) {
      return;
    }
    if (!pointer.active && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10) {
      cancelArmDrag();
    }
    if (pointer.active) {
      event.preventDefault();
    }
  };

  const finishReorder = (event, type) => {
    const pointer = reorderPointerRef.current;
    cancelArmDrag();
    if (!pointer || pointer.pointerId !== event.pointerId || !pointer.active || pointer.type !== type) {
      reorderPointerRef.current = null;
      setDraggingItem(null);
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 80);
      return;
    }
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest(`[data-reorder-type="${type}"]`);
    const to = Number(target?.getAttribute('data-reorder-index'));
    if (!Number.isFinite(to)) {
      reorderPointerRef.current = null;
      setDraggingItem(null);
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 80);
      return;
    }
    if (type === 'light') {
      setLights(prev => reorderItems(prev, pointer.index, to));
    }
    if (type === 'device') {
      setDevices(prev => reorderItems(prev, pointer.index, to));
    }
    reorderPointerRef.current = null;
    setDraggingItem(null);
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 120);
  };

  // const updateHeatingTarget = (index, amount) => {
  //   setHeating(prev => prev.map((item, i) => {
  //     if (i !== index) {
  //       return item;
  //     }
  //     return {
  //       ...item,
  //       target: Math.max(18, Math.min(30, item.target + amount)),
  //     };
  //   }));
  // };

  if (idle) {
    return (
      <main className="idle-screen" onClick={() => setIdle(false)}>
        <div className="idle-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="img">
            <path d="M7 10V8a5 5 0 0 1 10 0v2" />
            <rect x="5" y="10" width="14" height="10" rx="3" />
          </svg>
        </div>
        <h1>대기 중</h1>
        <p>가까이 다가오면 홈 화면을 보여줘요</p>
        <Button size="large" variant="fill" color="primary" onClick={() => setIdle(false)}>
          화면 켜기
        </Button>
      </main>
    );
  }

  return (
    <main
      className={`page ${darkMode ? 'theme-dark' : 'theme-light'}`}
      onPointerDown={(event) => startVerticalScroll(event, pageDragRef)}
      onPointerMove={(event) => moveVerticalScroll(event, pageDragRef)}
      onPointerUp={() => endVerticalScroll(pageDragRef)}
      onPointerCancel={() => endVerticalScroll(pageDragRef)}
      onPointerLeave={() => endVerticalScroll(pageDragRef)}
    >
      <header className="home-header">
        <div>
          <p className="eyebrow">HOME</p>
          <h1>우리 집</h1>
          <div className="badges">
            <Badge size="small" color={smartThingsStatus === 'connected' ? 'blue' : smartThingsStatus === 'failed' ? 'red' : 'elephant'} variant="weak">
              SmartThings {smartThingsStatus === 'connected' ? '연결됨' : smartThingsStatus === 'connecting' ? '연결 중' : smartThingsStatus === 'failed' ? '연결 실패' : '연결 전'}
            </Badge>
            <Badge size="small" color="green" variant="weak">사람 감지됨</Badge>
          </div>
        </div>
        <div className="right-header">
          <button
            className="theme-toggle"
            onClick={() => setDarkMode(value => !value)}
            aria-label={darkMode ? '라이트 모드로 전환' : '다크 모드로 전환'}
          >
            <span>{darkMode ? '☾' : '☀'}</span>
          </button>
          <button
            className="theme-toggle"
            onClick={() => openSettings('앱 설정')}
            aria-label="설정 열기"
          >
            <span>⚙</span>
          </button>
          <div className="home-meta">
            <strong>02:07</strong>
            <span>9월 7일 · 24.3°C</span>
            <button className="standby-button" onClick={() => setIdle(true)}>
              화면 대기
            </button>
          </div>
        </div>
      </header>

      {(notifications.length > 0 || closingNotifications.length > 0) && (
        <div className={`notice-stack ${visibleNotifications.length === 0 ? 'emptying' : ''}`}>
          {notifications.slice(0, 4).map((notification, index) => (
            <button
              className={`notice ${index > 0 ? 'stacked' : ''} ${closingNotifications.includes(notification.id) ? 'closing' : ''}`}
              key={notification.id}
              style={{
                '--notice-index': index,
                '--notice-hidden-count': Math.max(0, notifications.length - 1),
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                dismissNotification(notification.id);
              }}
            >
              <span className="notice-icon">✓</span>
              <span>
                <b>{notification.title}</b>
                <em>{notification.message}</em>
              </span>
              {index === 0 && notifications.length > 1 && (
                <small>{notifications.length - 1}개 더 있음</small>
              )}
            </button>
          ))}
        </div>
      )}

      <section className="panel-block lighting-panel">
        <div className="block-header">
          <button
            className="block-title-button"
            onClick={() => setLightingCollapsed(value => !value)}
            aria-expanded={!lightingCollapsed}
            aria-label={lightingCollapsed ? '조명 탭 펼치기' : '조명 탭 축소하기'}
          >
            <h1>조명</h1>
            <div className="badges">
              <Badge size="small" color="blue" variant="weak">{lights.length}개 조명</Badge>
              <Badge size="small" color="green" variant="weak">{lightOnCount}개 켜짐</Badge>
            </div>
          </button>
          <Button
            size="small"
            variant="weak"
            color="primary"
            onClick={() => {
              setLights(prev => prev.map(item => ({ ...item, checked: !hasLightOn })));
              addNotification(
                hasLightOn ? '집 전체 조명 꺼짐' : '집 전체 조명 켜짐',
                hasLightOn ? '모든 조명이 꺼졌어요.' : '모든 조명이 켜졌어요.',
              );
            }}
          >
            {hasLightOn ? '집 전체 소등' : '집 전체 점등'}
          </Button>
        </div>
        <div className={`collapsible-panel ${lightingCollapsed ? 'collapsed' : ''}`}>
          <div
            className={`room-carousel ${carouselScrolling ? 'scrolling' : ''}`}
            onPointerDown={startCarouselScroll}
            onPointerMove={moveCarouselScroll}
            onPointerUp={endCarouselScroll}
            onPointerCancel={endCarouselScroll}
            onPointerLeave={endCarouselScroll}
          >
            {lights.map((light, index) => (
              <button
                className={`room-card ${light.checked ? 'on' : ''} ${draggingItem?.type === 'light' && draggingItem.index === index ? 'dragging' : ''}`}
                key={light.name}
                data-reorder-type="light"
                data-reorder-index={index}
                onPointerDown={(event) => armDrag(event, 'light', index)}
                onPointerMove={moveReorderPointer}
                onPointerUp={(event) => finishReorder(event, 'light')}
                onPointerCancel={cancelArmDrag}
                onPointerLeave={cancelArmDrag}
                onClick={() => {
                  if (suppressClickRef.current) {
                    return;
                  }
                  const nextChecked = !light.checked;
                  setLights(prev => prev.map((item, i) => i === index ? { ...item, checked: !item.checked } : item));
                  addNotification(
                    `${light.name} 조명 ${nextChecked ? '켜짐' : '꺼짐'}`,
                    `조명이 ${nextChecked ? '켜졌어요.' : '꺼졌어요.'}`,
                  );
                }}
              >
                <span className="bulb">◌</span>
                <strong>{light.name}</strong>
              </button>
            ))}
          </div>
          <div className={`room-scroll-indicator ${carouselScrolling ? 'visible' : ''}`} aria-hidden="true">
            <span style={{ left: `${carouselBar.left}%`, width: `${carouselBar.width}%` }} />
          </div>
        </div>
      </section>

      {/* <section className="panel-block heating-panel">
        <div className="block-header">
          <div>
            <h1>난방</h1>
            <div className="badges">
              <Badge size="small" color="blue" variant="weak">5개 방</Badge>
              <Badge size="small" color="green" variant="weak">2개 켜짐</Badge>
            </div>
          </div>
          <Button
            size="small"
            variant="weak"
            color="primary"
            onClick={() => setHeating(prev => prev.map(item => ({ ...item, on: false })))}
          >
            전체 끄기
          </Button>
        </div>
        <div className="heating-grid">
          {heating.map((room, index) => (
            <button
              className={`heating-card ${room.on ? 'on' : ''}`}
              key={room.name}
              onClick={() => setHeating(prev => prev.map((item, i) => i === index ? { ...item, on: !item.on } : item))}
            >
              <span className="heating-top">
                <strong>{room.name}</strong>
                <span className={`mini-switch ${room.on ? 'on' : ''}`} />
              </span>
              <span className="temperature">{room.temp}°C</span>
              <span className="target-control">
                <button
                  className="round-control"
                  onClick={(event) => {
                    event.stopPropagation();
                    updateHeatingTarget(index, -1);
                  }}
                >
                  -
                </button>
                <em>{room.target}°C</em>
                <button
                  className="round-control"
                  onClick={(event) => {
                    event.stopPropagation();
                    updateHeatingTarget(index, 1);
                  }}
                >
                  +
                </button>
              </span>
            </button>
          ))}
        </div>
      </section> */}

      <section className="panel-block appliance-panel">
        <div className="block-header">
          <button
            className="block-title-button"
            onClick={() => setApplianceCollapsed(value => !value)}
            aria-expanded={!applianceCollapsed}
            aria-label={applianceCollapsed ? '가전 탭 펼치기' : '가전 탭 축소하기'}
          >
            <h1>가전</h1>
            <div className="badges">
              <Badge size="small" color={stationConnected ? 'blue' : 'elephant'} variant="weak">
                스테이션 {stationConnected ? '연결됨' : '연결 전'}
              </Badge>
              <Badge size="small" color="blue" variant="weak">{devices.length}개 기기</Badge>
              <Badge size="small" color="green" variant="weak">{activeDeviceCount}개 동작</Badge>
            </div>
          </button>
        </div>
        <div className={`collapsible-panel ${applianceCollapsed ? 'collapsed' : ''}`}>
          <div className="appliance-grid">
            {devices.map((device, index) => (
              <button
                className={`appliance-card ${device.checked ? 'on' : ''} ${draggingItem?.type === 'device' && draggingItem.index === index ? 'dragging' : ''}`}
                key={device.deviceId || device.name}
                data-reorder-type="device"
                data-reorder-index={index}
                onPointerDown={(event) => armDrag(event, 'device', index)}
                onPointerMove={moveReorderPointer}
                onPointerUp={(event) => finishReorder(event, 'device')}
                onPointerCancel={cancelArmDrag}
                onPointerLeave={cancelArmDrag}
                onClick={() => {
                  if (suppressClickRef.current) {
                    return;
                  }
                  openSettings(device.name);
                }}
              >
                <span className="appliance-top">
                  <strong>{device.name}</strong>
                  <span
                    className={`mini-switch ${device.checked ? 'on' : ''}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleDevice(index);
                    }}
                  />
                </span>
                <span className="appliance-status">
                  <Badge size="xsmall" color={device.color} variant="weak">
                    {device.name === '에어컨' ? `${airconMode} 중` : device.status}
                  </Badge>
                </span>
                <em>{device.name === '에어컨' ? `설정 ${airconTemp}°C` : device.detail}</em>
              </button>
            ))}
          </div>
        </div>
      </section>

      {settingsDevice && (
        <div
          className={`settings-dim ${settingsClosing ? 'closing' : ''}`}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              closeSettings();
            }
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeSettings();
            }
          }}
        >
          <section
            className={`settings-sheet ${sheetScrolling ? 'scrolling' : ''} ${settingsClosing ? 'closing' : ''}`}
            onClick={(event) => event.stopPropagation()}
            onScroll={showSheetScroll}
            onWheel={showSheetScroll}
            onPointerDown={(event) => {
              event.stopPropagation();
              startVerticalScroll(event, sheetDragRef);
            }}
            onPointerMove={(event) => moveVerticalScroll(event, sheetDragRef, showSheetScroll)}
            onPointerUp={() => endVerticalScroll(sheetDragRef)}
            onPointerCancel={() => endVerticalScroll(sheetDragRef)}
            onPointerLeave={() => endVerticalScroll(sheetDragRef)}
            >
            <div className="settings-handle" />
            <div className="settings-content">
            {settingsDevice === '에어컨' && (
              <AirconSettings
                temp={airconTemp}
                mode={airconMode}
                setTemp={setAirconTemp}
                setMode={setAirconMode}
                refreshStatus={() => refreshDeviceStatus(devices.find(device => device.name === '에어컨'))}
                refreshing={refreshingDeviceId === devices.find(device => device.name === '에어컨')?.deviceId}
                schedule={deviceSchedules['에어컨']}
                setSchedule={(schedule) => setDeviceSchedule('에어컨', schedule)}
                openSchedulePicker={(field, label) => openSchedulePicker('에어컨', field, label)}
              />
            )}
            {settingsDevice === '세탁기' && (
              <ApplianceChoiceSettings
                title="세탁기 설정"
                description="세탁 코스와 예약 상태를 확인해요."
                label="세탁 코스"
                options={['표준', '쾌속', '섬세', '헹굼+탈수']}
                value={washerCourse}
                setValue={setWasherCourse}
                rows={[
                  ['남은 시간', '32분'],
                  ['완료 예정', '오전 2:39'],
                ]}
                refreshStatus={() => refreshDeviceStatus(devices.find(device => device.name === '세탁기'))}
                refreshing={refreshingDeviceId === devices.find(device => device.name === '세탁기')?.deviceId}
                schedule={deviceSchedules['세탁기']}
                setSchedule={(schedule) => setDeviceSchedule('세탁기', schedule)}
                openSchedulePicker={(field, label) => openSchedulePicker('세탁기', field, label)}
              />
            )}
            {settingsDevice === '건조기' && (
              <ApplianceChoiceSettings
                title="건조기 설정"
                description="건조 코스와 보관 옵션을 바꿀 수 있어요."
                label="건조 코스"
                options={['표준 건조', '강력', '송풍', '섬세']}
                value={dryerCourse}
                setValue={setDryerCourse}
                rows={[
                  ['구김방지', '켜짐'],
                  ['종료 후', '보관'],
                ]}
                refreshStatus={() => refreshDeviceStatus(devices.find(device => device.name === '건조기'))}
                refreshing={refreshingDeviceId === devices.find(device => device.name === '건조기')?.deviceId}
                schedule={deviceSchedules['건조기']}
                setSchedule={(schedule) => setDeviceSchedule('건조기', schedule)}
                openSchedulePicker={(field, label) => openSchedulePicker('건조기', field, label)}
              />
            )}
            {settingsDevice === '로보락' && (
              <ApplianceChoiceSettings
                title="로보락 설정"
                description="청소 동작과 흡입 세기를 선택해요."
                label="흡입 세기"
                options={['조용', '일반', '강력', 'MAX']}
                value={vacuumPower}
                setValue={setVacuumPower}
                rows={[
                  ['배터리', '87%'],
                  ['상태', '충전 중'],
                ]}
                actions={['청소 시작', '충전기로 복귀']}
                refreshStatus={() => refreshDeviceStatus(devices.find(device => device.name === '로보락'))}
                refreshing={refreshingDeviceId === devices.find(device => device.name === '로보락')?.deviceId}
                schedule={deviceSchedules['로보락']}
                setSchedule={(schedule) => setDeviceSchedule('로보락', schedule)}
                openSchedulePicker={(field, label) => openSchedulePicker('로보락', field, label)}
              />
            )}
            {selectedIsAirPurifier && (
              <AirPurifierSettings
                device={selectedDevice}
                value={airPurifierMode}
                setValue={setAirPurifierMode}
                sendCommand={sendDeviceCommand}
                refreshStatus={refreshDeviceStatus}
                refreshing={refreshingDeviceId === selectedDevice?.deviceId}
                schedule={deviceSchedules[selectedDevice?.deviceId || selectedDevice?.name]}
                setSchedule={(schedule) => setDeviceSchedule(selectedDevice?.deviceId || selectedDevice?.name, schedule)}
                openSchedulePicker={(field, label) => openSchedulePicker(selectedDevice?.deviceId || selectedDevice?.name, field, label)}
              />
            )}
            {settingsDevice === '앱 설정' && (
              <SystemSettings
                brightness={screenBrightness}
                setBrightness={setScreenBrightness}
                timeout={screenTimeout}
                setTimeout={setScreenTimeout}
                autoDarkMode={autoDarkMode}
                setAutoDarkMode={setAutoDarkMode}
                presenceDetection={presenceDetection}
                setPresenceDetection={setPresenceDetection}
                sensitivity={presenceSensitivity}
                setSensitivity={setPresenceSensitivity}
                smartThingsStatus={smartThingsStatus}
                setSmartThingsStatus={setSmartThingsStatus}
                smartThingsToken={smartThingsToken}
                setSmartThingsToken={setSmartThingsToken}
                smartThingsApiLog={smartThingsApiLog}
                setSmartThingsApiLog={setSmartThingsApiLog}
                setDevices={setDevices}
                stationConnected={stationConnected}
                setStationConnected={setStationConnected}
              />
            )}
            </div>
            <div className="settings-footer">
              <Button size="large" variant="fill" color="primary" display="full" onClick={closeSettings}>
              완료
              </Button>
            </div>
            {schedulePicker && (
              <SchedulePicker
                picker={schedulePicker}
                value={deviceSchedules[schedulePicker.scheduleKey]?.[schedulePicker.field] || ''}
                closing={schedulePickerClosing}
                onSelect={(value) => {
                  setDeviceSchedules(prev => ({
                    ...prev,
                    [schedulePicker.scheduleKey]: {
                      ...(prev[schedulePicker.scheduleKey] || {}),
                      [schedulePicker.field]: value,
                    },
                  }));
                  closeSchedulePicker();
                }}
                onClose={closeSchedulePicker}
              />
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function SystemSettings({
  brightness,
  setBrightness,
  timeout,
  setTimeout,
  autoDarkMode,
  setAutoDarkMode,
  presenceDetection,
  setPresenceDetection,
  sensitivity,
  setSensitivity,
  smartThingsStatus,
  setSmartThingsStatus,
  smartThingsToken,
  setSmartThingsToken,
  smartThingsApiLog,
  setSmartThingsApiLog,
  setDevices,
  stationConnected,
  setStationConnected,
}) {
  const [tokenMasked, setTokenMasked] = useState(false);
  const statusLabel = {
    disconnected: '연결 전',
    connecting: '연결 중',
    connected: '연결 완료',
    failed: '연결 실패',
  }[smartThingsStatus];

  const requestConnection = () => {
    setSmartThingsStatus('connecting');
    setSmartThingsApiLog('Samsung OAuth 승인 화면으로 이동하는 단계예요.');
    window.setTimeout(() => {
      setSmartThingsStatus(smartThingsToken.trim() ? 'connected' : 'failed');
      if (smartThingsToken.trim()) setTokenMasked(true);
      setSmartThingsApiLog(
        smartThingsToken.trim()
          ? '토큰 확인 완료. 이제 기기 목록 API를 호출할 수 있어요.'
          : '토큰이 없어서 연결에 실패했어요.'
      );
    }, 650);
  };

  const refreshToken = async () => {
    if (!smartThingsToken.trim()) {
      setSmartThingsStatus('failed');
      setSmartThingsApiLog('갱신할 토큰이 없어요. access token 또는 refresh token을 입력해주세요.');
      return;
    }
    setSmartThingsStatus('connecting');
    setSmartThingsApiLog('토큰 갱신 요청을 준비 중이에요.');
    try {
      const response = await apiFetch('/api/token/refresh', { method: 'POST' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      setSmartThingsStatus('connected');
      setTokenMasked(true);
      setSmartThingsApiLog('토큰 갱신 완료. 예약 실행 때도 만료 전에 자동으로 갱신해요.');
    } catch (error) {
      setSmartThingsStatus('failed');
      setSmartThingsApiLog(`토큰 자동 갱신 준비가 아직 안 됐어요. refresh token과 앱 client id/secret 설정이 필요해요. (${error.message})`);
    }
  };

  const syncSmartThings = async () => {
    if (!smartThingsToken.trim()) {
      setSmartThingsStatus('failed');
      setSmartThingsApiLog('동기화 실패. 먼저 토큰을 입력해주세요.');
      return;
    }
    setSmartThingsStatus('connecting');
    setSmartThingsApiLog('SmartThings에 등록된 전체 기기 목록을 가져오는 중이에요.');
    try {
      const response = await fetch('https://api.smartthings.com/v1/devices', {
        headers: {
          Authorization: `Bearer ${smartThingsToken.trim()}`,
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      const seenDeviceKeys = new Set();
      let hasStation = false;
      const deviceItems = await Promise.all((data.items ?? []).map(async (device) => {
        const capabilities = (device.components ?? [])
          .flatMap(component => component.capabilities ?? [])
          .map(capability => capability.id ?? capability);
        const label = device.label || device.name || device.deviceTypeName || '이름 없는 기기';
        const deviceKey = device.deviceId || label;
        if (seenDeviceKeys.has(deviceKey)) {
          return null;
        }
        seenDeviceKeys.add(deviceKey);
        const isStation = /station/i.test(label) || /station/i.test(device.deviceTypeName ?? '');
        if (isStation) {
          hasStation = true;
          return null;
        }
        const isAirPurifier = /공기청정|air purifier/i.test(label) || capabilities.some(id => /air|fan/i.test(id));
        let status = {};
        try {
          const statusResponse = await fetch(`https://api.smartthings.com/v1/devices/${device.deviceId}/status`, {
            headers: {
              Authorization: `Bearer ${smartThingsToken.trim()}`,
              Accept: 'application/json',
            },
          });
          if (statusResponse.ok) {
            status = await statusResponse.json();
          }
        } catch {
          status = {};
        }
        const componentStatus = status.components?.main ?? {};
        const switchValue = componentStatus.switch?.switch?.value;
        const filterValue =
          componentStatus.filterState?.filterLifeRemaining?.value ??
          componentStatus.dustFilter?.dustFilterStatus?.value ??
          componentStatus.airFilter?.filterLifeRemaining?.value ??
          findStatusValue(componentStatus, key => /filter/i.test(key) && /(life|remain|percent|status)/i.test(key));
        const airQualityValue =
          componentStatus.airQualitySensor?.airQuality?.value ??
          componentStatus.fineDustSensor?.fineDustLevel?.value ??
          componentStatus.veryFineDustSensor?.veryFineDustLevel?.value ??
          findStatusValue(componentStatus, key => /(airQuality|dust|pm25|pm10|fineDust)/i.test(key));
        return {
          deviceId: device.deviceId,
          locationId: device.locationId,
          componentId: device.components?.[0]?.id || 'main',
          capabilities,
          statusPayload: componentStatus,
          name: label,
          status: isAirPurifier
            ? toModeLabel(componentStatus.fanMode?.fanMode?.value || componentStatus.airConditionerFanMode?.fanMode?.value || '상태 확인됨')
            : switchValue === 'on' ? '켜짐' : '대기',
          detail: isAirPurifier && filterValue != null
            ? `필터 ${filterValue}%`
            : device.roomName ? `${device.roomName} · SmartThings` : 'SmartThings 등록 기기',
          checked: switchValue ? switchValue === 'on' : capabilities.includes('switch'),
          airQuality: airQualityValue,
          filterLife: filterValue,
          color: isAirPurifier ? 'green' : 'elephant',
        };
      }));
      const smartThingsDevices = deviceItems.filter(Boolean);
      if (smartThingsDevices.length === 0) {
        setSmartThingsStatus('failed');
        setSmartThingsApiLog('토큰은 응답했지만 접근 가능한 기기가 없어요. 토큰 권한에 r:devices:*가 있는지 확인해주세요.');
        return;
      }
      setStationConnected(hasStation);
      setDevices(smartThingsDevices);
      setSmartThingsStatus('connected');
      setTokenMasked(true);
      setSmartThingsApiLog(
        hasStation
          ? `스테이션 연결 확인. 조작 가능한 ${smartThingsDevices.length}개 기기만 가전 목록에 반영했어요.`
          : `SmartThings 동기화 완료. ${smartThingsDevices.length}개 기기를 가전 목록에 반영했어요.`
      );
    } catch (error) {
      setSmartThingsStatus('failed');
      setSmartThingsApiLog(`동기화 실패: ${error.message}. 브라우저에서 막히면 백엔드 프록시가 필요해요.`);
    }
  };

  return (
    <>
      <h2>설정</h2>
      <p>화면, 감지, 연결 상태를 빠르게 바꿔요.</p>
      <div className="settings-group">
        <h3>화면</h3>
        <div className="setting-stack">
          <div className="setting-row compact">
            <span>밝기</span>
            <strong>{brightness}%</strong>
          </div>
          <input
            className="brightness-slider"
            type="range"
            min="1"
            max="100"
            value={brightness}
            onChange={(event) => setBrightness(Number(event.target.value))}
          />
        </div>
        <ChoiceGroup
          label="화면 꺼짐"
          options={['30초', '60초', '항상 켜짐']}
          value={timeout}
          setValue={setTimeout}
        />
        <div className="setting-row">
          <span>자동 다크모드</span>
          <button
            className={`inline-switch ${autoDarkMode ? 'on' : ''}`}
            onClick={() => setAutoDarkMode(value => !value)}
            aria-label="자동 다크모드 전환"
          />
        </div>
      </div>
      <div className="settings-group">
        <h3>감지</h3>
        <div className="setting-row">
          <span>사람 감지</span>
          <button
            className={`inline-switch ${presenceDetection ? 'on' : ''}`}
            onClick={() => setPresenceDetection(value => !value)}
            aria-label="사람 감지 전환"
          />
        </div>
        <ChoiceGroup
          label="민감도"
          options={['낮음', '보통', '높음']}
          value={sensitivity}
          setValue={setSensitivity}
        />
      </div>
      <div className="settings-group">
        <h3>연결</h3>
        <div className="connection-status">
          <span className={`status-dot ${smartThingsStatus}`} />
          <div>
            <strong>SmartThings {statusLabel}</strong>
            <em>{smartThingsStatus === 'connected' ? '기기 동기화를 사용할 수 있어요.' : '삼성 계정 승인 또는 토큰 입력이 필요해요.'}</em>
          </div>
        </div>
        <div className="setting-row">
          <span>SmartThings</span>
          <strong>{statusLabel}</strong>
        </div>
        <div className="setting-row">
          <span>SmartThings Station</span>
          <strong>{stationConnected ? '연결됨' : '-'}</strong>
        </div>
        <div className="setting-row">
          <span>마지막 동기화</span>
          <strong>{smartThingsStatus === 'connected' ? '방금 전' : '-'}</strong>
        </div>
        <label className="token-field">
          <span>개발용 토큰</span>
          <textarea
            value={tokenMasked ? `${'•'.repeat(Math.max(0, smartThingsToken.length - 4))}${smartThingsToken.slice(-4)}` : smartThingsToken}
            onFocus={() => setTokenMasked(false)}
            onChange={(event) => {
              setTokenMasked(false);
              setSmartThingsToken(event.target.value);
            }}
            placeholder="SmartThings access token 또는 refresh token"
            rows={3}
          />
        </label>
        <div className="connection-actions">
          <button className="secondary-action" onClick={requestConnection}>
            연결하기
          </button>
          <button className="secondary-action" onClick={refreshToken}>
            토큰 갱신
          </button>
          <button className="secondary-action" onClick={syncSmartThings}>
            SmartThings 동기화
          </button>
        </div>
        <div className="api-log">{smartThingsApiLog}</div>
        <button
          className="secondary-action"
          onClick={() => {
            setSmartThingsStatus('disconnected');
            setStationConnected(false);
            setSmartThingsToken('');
            setSmartThingsApiLog('연결을 해제했어요. 화면에는 디자인용 예시 기기만 남아 있어요.');
          }}
        >
          연결 해제
        </button>
      </div>
    </>
  );
}

function ScheduleSettings({ schedule = {}, setSchedule, openSchedulePicker }) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const selectedDays = schedule.days || [];
  const toggleDay = (day) => {
    const nextDays = selectedDays.includes(day)
      ? selectedDays.filter(item => item !== day)
      : [...selectedDays, day];
    setSchedule?.(prev => ({
      ...prev,
      days: nextDays,
    }));
  };

  return (
    <div className="schedule-settings">
      <span>예약 시간</span>
      <div className="schedule-grid">
        <button onClick={() => openSchedulePicker?.('on', '켜짐 예약')}>
          <em>켜짐</em>
          <strong>{schedule.on || '--:--'}</strong>
        </button>
        <button onClick={() => openSchedulePicker?.('off', '꺼짐 예약')}>
          <em>꺼짐</em>
          <strong>{schedule.off || '--:--'}</strong>
        </button>
      </div>
      <div className="schedule-days">
        <em>반복 요일</em>
        <div>
          {days.map(day => (
            <button
              key={day}
              className={selectedDays.includes(day) ? 'selected' : ''}
              onClick={() => toggleDay(day)}
            >
              {day}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SchedulePicker({ picker, value, closing, onSelect, onClose }) {
  const [period, setPeriod] = useState(value && Number(value.slice(0, 2)) >= 12 ? '오후' : '오전');
  const [hour, setHour] = useState(() => {
    const rawHour = value ? Number(value.slice(0, 2)) : 7;
    const converted = rawHour > 12 ? rawHour - 12 : rawHour === 0 ? 12 : rawHour;
    return String(converted).padStart(2, '0');
  });
  const [minute, setMinute] = useState(value ? value.slice(3, 5) : '00');
  const hours = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
  const minutes = ['00', '10', '20', '30', '40', '50'];
  const confirm = () => {
    const hourNumber = Number(hour);
    const normalizedHour = period === '오후'
      ? hourNumber === 12 ? 12 : hourNumber + 12
      : hourNumber === 12 ? 0 : hourNumber;
    onSelect(`${String(normalizedHour).padStart(2, '0')}:${minute}`);
  };

  return (
    <div
      className={`schedule-picker ${closing ? 'closing' : ''}`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className={`schedule-picker-card ${closing ? 'closing' : ''}`}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onPointerCancel={(event) => event.stopPropagation()}
      >
        <div className="sheet-title-row">
          <div>
            <h2>{picker.label}</h2>
            <p>가전이 동작할 시간을 선택해요.</p>
          </div>
          <button className="icon-action" onClick={onClose} aria-label="예약 시간 닫기">×</button>
        </div>
        <div className="wheel-picker">
          <WheelColumn items={['오전', '오후']} value={period} onChange={setPeriod} className="period" />
          <WheelColumn items={hours} value={hour} onChange={setHour} />
          <div className="wheel-separator">:</div>
          <WheelColumn items={minutes} value={minute} onChange={setMinute} />
        </div>
        <Button size="large" variant="fill" color="primary" display="full" onClick={confirm}>
          저장
        </Button>
      </div>
    </div>
  );
}

function WheelColumn({ items, value, onChange, className = '' }) {
  const slotHeight = 50;
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const selectedIndex = Math.max(0, items.indexOf(value));
  const visibleOffsets = [-2, -1, 0, 1, 2];

  const moveBy = (offset) => {
    onChange(items[(selectedIndex + offset + items.length) % items.length]);
  };

  const startDrag = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      y: event.clientY,
      moved: false,
    };
    setDragging(true);
    setDragOffset(0);
  };

  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const nextOffset = Math.max(-slotHeight, Math.min(slotHeight, event.clientY - drag.y));
    if (Math.abs(nextOffset) > 4) {
      drag.moved = true;
      suppressClickRef.current = true;
    }
    setDragOffset(nextOffset);
  };

  const endDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (dragOffset <= -18) {
      moveBy(1);
    } else if (dragOffset >= 18) {
      moveBy(-1);
    }
    dragRef.current = null;
    setDragging(false);
    setDragOffset(0);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 80);
  };

  return (
    <div
      className={`wheel-column ${className} ${dragging ? 'dragging' : ''}`}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="wheel-lines" />
      {visibleOffsets.map((offset) => {
        const item = items[(selectedIndex + offset + items.length) % items.length];
        const y = (offset * slotHeight) + dragOffset;
        const activeDistance = Math.min(2, Math.abs(offset + (dragOffset / slotHeight)));
        const scale = Math.max(0.74, 1 - (activeDistance * 0.12));
        const opacity = Math.max(0.24, 1 - (activeDistance * 0.36));
        return (
          <button
            key={`${item}-${offset}`}
            className={`wheel-row ${offset === 0 ? 'selected' : ''}`}
            style={{
              transform: `translateY(${y}px) translateY(-50%) scale(${scale})`,
              opacity,
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (suppressClickRef.current || offset === 0) {
                return;
              }
              moveBy(offset);
            }}
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}

function ApplianceSettingsHeader({ title, description, onRefresh, refreshing = false }) {
  return (
    <div className="sheet-title-row">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <button className={`icon-action ${refreshing ? 'spinning' : ''}`} onClick={onRefresh} aria-label="상태 새로고침">
        <svg viewBox="0 0 24 24">
          <path d="M20 11a8 8 0 0 0-14.7-4.4L4 8" />
          <path d="M4 4v4h4" />
          <path d="M4 13a8 8 0 0 0 14.7 4.4L20 16" />
          <path d="M20 20v-4h-4" />
        </svg>
      </button>
    </div>
  );
}

function AirconSettings({ temp, mode, setTemp, setMode, refreshStatus, refreshing, schedule, setSchedule, openSchedulePicker }) {
  return (
    <>
      <ApplianceSettingsHeader
        title="에어컨 설정"
        description="희망온도와 운전 모드를 바로 바꿀 수 있어요."
        onRefresh={refreshStatus}
        refreshing={refreshing}
      />
      <div className="temperature-picker">
        <span>희망온도</span>
        <div className="temperature-stepper">
          <button onClick={() => setTemp(value => Math.max(18, value - 1))}>-</button>
          <strong>{temp}°C</strong>
          <button onClick={() => setTemp(value => Math.min(30, value + 1))}>+</button>
        </div>
      </div>
      <ChoiceGroup label="모드" options={['냉방', '제습', '송풍']} value={mode} setValue={setMode} />
      <ScheduleSettings schedule={schedule} setSchedule={setSchedule} openSchedulePicker={openSchedulePicker} />
    </>
  );
}

function AirPurifierSettings({ device, value, setValue, sendCommand, refreshStatus, refreshing, schedule, setSchedule, openSchedulePicker }) {
  const capabilities = device?.capabilities ?? [];
  const fanModeCapability = capabilities.includes('airConditionerFanMode') ? 'airConditionerFanMode' : 'fanMode';
  const canChangeFanMode = capabilities.includes('fanMode') || capabilities.includes('airConditionerFanMode');
  const airQualityRaw = device?.airQuality ?? device?.statusPayload?.airQualitySensor?.airQuality?.value;
  const airQualityMap = {
    1: '매우 좋음',
    2: '좋음',
    3: '보통',
    4: '나쁨',
    5: '매우 나쁨',
  };
  const airQuality = airQualityMap[airQualityRaw] || airQualityRaw || '확인 안됨';
  const modeOptions = ['자동', '약풍', '강풍', '취침'];
  const syncedMode = toModeLabel(device?.statusPayload?.fanMode?.fanMode?.value || device?.statusPayload?.airConditionerFanMode?.fanMode?.value || device?.status);
  const currentMode = syncedMode && modeOptions.includes(syncedMode) ? syncedMode : value;
  const commandMap = {
    자동: ['setFanMode', ['auto']],
    약풍: ['setFanMode', ['low']],
    강풍: ['setFanMode', ['high']],
    취침: ['setFanMode', ['sleep']],
  };
  const selectMode = (mode) => {
    setValue(mode);
    if (!canChangeFanMode) {
      return;
    }
    const [command, args] = commandMap[mode];
    sendCommand(device, fanModeCapability, command, args);
  };
  return (
    <>
      <ApplianceSettingsHeader
        title="공기청정기 설정"
        description="운전 모드와 공기 상태를 확인해요."
        onRefresh={() => refreshStatus(device)}
        refreshing={refreshing}
      />
      <ChoiceGroup label="운전 모드" options={modeOptions} value={currentMode} setValue={selectMode} />
      <div className="info-list">
        <div className="setting-row">
          <span>실내 공기</span>
          <strong>{airQuality}</strong>
        </div>
      </div>
      <ScheduleSettings schedule={schedule} setSchedule={setSchedule} openSchedulePicker={openSchedulePicker} />
    </>
  );
}

function ApplianceChoiceSettings({ title, description, label, options, value, setValue, rows, actions = [], refreshStatus, refreshing, schedule, setSchedule, openSchedulePicker }) {
  return (
    <>
      <ApplianceSettingsHeader
        title={title}
        description={description}
        onRefresh={refreshStatus}
        refreshing={refreshing}
      />
      <ChoiceGroup label={label} options={options} value={value} setValue={setValue} />
      <div className="info-list">
        {rows.map(([key, item]) => (
          <div className="setting-row" key={key}>
            <span>{key}</span>
            <strong>{item}</strong>
          </div>
        ))}
      </div>
      {actions.length > 0 && (
        <div className="action-grid">
          {actions.map(action => <button key={action}>{action}</button>)}
        </div>
      )}
      {setSchedule && <ScheduleSettings schedule={schedule} setSchedule={setSchedule} openSchedulePicker={openSchedulePicker} />}
    </>
  );
}

function ChoiceGroup({ label, options, value, setValue }) {
  return (
    <div className="mode-picker">
      <span>{label}</span>
      <div className="mode-list">
        {options.map(option => (
          <button
            key={option}
            className={value === option ? 'selected' : ''}
            onClick={() => setValue(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <TDSMobileAITProvider>
    <App />
  </TDSMobileAITProvider>
);
