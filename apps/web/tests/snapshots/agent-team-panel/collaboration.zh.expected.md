## Menu

- menu "模型":
  - group "Tokamak":
    - menuitemradio "Tokamak 1 Preview" [checked]
    - menuitemradio "Tokamak 1 Vision Experimental"

## Confirmation

- dialog "确认停用智能体团队协作？":
  - heading "确认停用智能体团队协作？" [level=2]
  - button "关闭"
  - paragraph: 对话过程中停用智能体团队协作，将停止共享任务工具和团队协调指令。
  - paragraph: 停用后可能影响缓存复用、增加后续 token 用量与开销，并影响当前任务的协作效果。
  - button "取消"
  - button "确认停用"
