from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.catalog.views import AdminCategoryViewSet, AdminContentViewSet, AdminTagViewSet
from apps.media_library.views import AdminMediaViewSet, PublicImageUploadView

from . import views as v

router = SimpleRouter()
router.register("contents", AdminContentViewSet, basename="admin-content")
router.register("categories", AdminCategoryViewSet, basename="admin-category")
router.register("tags", AdminTagViewSet, basename="admin-tag")
router.register("media", AdminMediaViewSet, basename="admin-media")
router.register("users", v.AdminUserViewSet, basename="admin-user")
router.register("orders", v.AdminOrderViewSet, basename="admin-order")
router.register("plans", v.AdminPlanViewSet, basename="admin-plan")
router.register("comments", v.AdminCommentViewSet, basename="admin-comment")
router.register("audit", v.AuditViewSet, basename="admin-audit")
urlpatterns = [
    path("dashboard/", v.DashboardView.as_view()),
    path("search/", v.CommandSearchView.as_view()),
    path("images/", PublicImageUploadView.as_view()),
    path("settings/site/", v.SiteSettingsView.as_view()),
    path("settings/payments/", v.GatewayConfigView.as_view()),
    path("settings/payments/test/", v.GatewayTestView.as_view()),
    path("settings/payments/live-test/", v.GatewayLiveTestView.as_view()),
    path("settings/payments/webhooks/", v.WebhookEventsView.as_view()),
    path("settings/storage/", v.StorageConfigView.as_view()),
    path("settings/storage/test/", v.StorageTestView.as_view()),
    *router.urls,
]
